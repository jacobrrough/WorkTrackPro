import type {
  GenerateResult,
  NewRecurringTemplateInput,
  RecurringBillPayload,
  RecurringInvoicePayload,
  RecurringJournalPayload,
  RecurringTemplate,
  UpdateRecurringTemplateInput,
} from '../../../features/accounting/types';
import { advanceSchedule, todayISO } from '../../../features/accounting/recurrence';
import { acct } from './accountingClient';
import { mapRecurringTemplateRow, type Row } from './mappers';
import { invoicesService } from './invoices';
import { billsService } from './bills';
import { journalService } from './journal';
import {
  buildRecurringBillInput,
  buildRecurringInvoiceInput,
  buildRecurringJournalLines,
} from './recurringPayload';

/**
 * Recurring transaction templates (accounting.recurring_templates). A template stores
 * INTENT only — a schedule plus a jsonb payload describing the next invoice/bill/journal
 * to materialize. It posts NO money itself.
 *
 * The "generate due" action (generateDue / generateAllDue) is the only money path: it
 * builds the next document for the template's `kind` and ALWAYS posts a BALANCED journal
 * entry through accounting.post_journal_entry —
 *   invoice → invoicesService.createDraft + send  (Dr AR / Cr Income / Cr Sales Tax)
 *   bill    → billsService.createDraft + post      (Dr Expense / Cr AP)
 *   journal → journalService.createAndPost         (explicit balanced Dr/Cr lines)
 * — so double-entry integrity (G3) holds end to end. Only after the JE is confirmed
 * posted does the schedule advance (advanceSchedule) and the bookkeeping columns update
 * (next_run_date / last_run_date / last_generated_id / occurrences_generated, and
 * active=false when the template reaches its end_date). A failed/unbalanced post leaves
 * the template's cursor untouched so the user can fix the payload and retry — no
 * partial state, no orphan draft (the underlying services clean up a failed post).
 *
 * Reads throw (React Query surfaces them); writes return result objects carrying the DB
 * error so the UI can show it inline.
 */
export const recurringTemplatesService = {
  /** All templates (optionally including inactive), newest-updated first. */
  async list(includeInactive = true): Promise<RecurringTemplate[]> {
    let query = acct()
      .from('recurring_templates')
      .select('*')
      .order('next_run_date', { ascending: true });
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapRecurringTemplateRow);
  },

  async getById(id: string): Promise<RecurringTemplate | null> {
    const { data, error } = await acct()
      .from('recurring_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapRecurringTemplateRow(data as Row);
  },

  /**
   * Active templates due to generate as of `asOf` (default today): active AND
   * next_run_date <= asOf. The end_date cutoff is enforced when generating (a template
   * past its end is simply never due because its next_run_date was nulled on the last
   * advance). Ordered oldest-due first.
   */
  async listDue(asOf: string = todayISO()): Promise<RecurringTemplate[]> {
    const { data, error } = await acct()
      .from('recurring_templates')
      .select('*')
      .eq('active', true)
      .lte('next_run_date', asOf)
      .order('next_run_date', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapRecurringTemplateRow);
  },

  /** Create a template. `next_run_date` defaults to `start_date` when not supplied. */
  async create(
    input: NewRecurringTemplateInput
  ): Promise<{ template: RecurringTemplate | null; error?: string }> {
    const name = input.name?.trim();
    if (!name) return { template: null, error: 'A recurring template needs a name.' };
    if (!input.payload || !Array.isArray(input.payload.lines) || input.payload.lines.length === 0) {
      return { template: null, error: 'A recurring template needs at least one payload line.' };
    }
    const { data, error } = await acct()
      .from('recurring_templates')
      .insert({
        name,
        kind: input.kind,
        frequency: input.frequency,
        interval_count: input.intervalCount ?? 1,
        start_date: input.startDate,
        end_date: input.endDate ?? null,
        next_run_date: input.nextRunDate ?? input.startDate,
        day_of_month: input.dayOfMonth ?? null,
        payload: input.payload,
        active: input.active ?? true,
      })
      .select('*')
      .single();
    if (error || !data)
      return { template: null, error: error?.message ?? 'Failed to create template.' };
    return { template: mapRecurringTemplateRow(data as Row) };
  },

  /** Patch a template's schedule/payload/active flag. `kind` is immutable post-create. */
  async update(
    id: string,
    input: UpdateRecurringTemplateInput
  ): Promise<{ template: RecurringTemplate | null; error?: string }> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { template: null, error: 'A recurring template needs a name.' };
      patch.name = name;
    }
    if (input.frequency !== undefined) patch.frequency = input.frequency;
    if (input.intervalCount !== undefined) patch.interval_count = input.intervalCount;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.endDate !== undefined) patch.end_date = input.endDate;
    if (input.nextRunDate !== undefined) patch.next_run_date = input.nextRunDate;
    if (input.dayOfMonth !== undefined) patch.day_of_month = input.dayOfMonth;
    if (input.payload !== undefined) {
      if (!Array.isArray(input.payload.lines) || input.payload.lines.length === 0) {
        return { template: null, error: 'A recurring template needs at least one payload line.' };
      }
      patch.payload = input.payload;
    }
    if (input.active !== undefined) patch.active = input.active;
    if (Object.keys(patch).length === 0) {
      return { template: await this.getById(id) };
    }
    const { data, error } = await acct()
      .from('recurring_templates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data)
      return { template: null, error: error?.message ?? 'Failed to update template.' };
    return { template: mapRecurringTemplateRow(data as Row) };
  },

  /** Pause/resume a template (active flag). Pausing stops it appearing as "due". */
  async setActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('recurring_templates').update({ active }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Materialize the next document/JE for ONE template as of `onDate` (default the
   * template's own next_run_date), posting a balanced JE, then advance the schedule.
   *
   * Order matters for integrity:
   *   1) build + post the document (the money movement) — if this fails, STOP and
   *      return the error with the cursor untouched (retry-safe; the doc services
   *      void/cleanup a half-post for us).
   *   2) only on a confirmed posted JE, advance the cursor + bookkeeping columns and
   *      deactivate the template if it has reached its end_date.
   * A failure to persist the cursor update after a successful post is surfaced but the
   * generated document stands (a duplicate on the next run is far worse than a stale
   * cursor the user can nudge).
   */
  async generateDue(id: string, onDate?: string): Promise<GenerateResult> {
    // Load the template, distinguishing a transient DB read error from a genuine
    // not-found (getById collapses both to null, which would mislabel a live template).
    const { data: tplRow, error: tplErr } = await acct()
      .from('recurring_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (tplErr) {
      return {
        templateId: id,
        generatedId: null,
        journalEntryId: null,
        nextRunDate: null,
        ended: false,
        error: `Could not load the template: ${tplErr.message}`,
      };
    }
    if (!tplRow) {
      return {
        templateId: id,
        generatedId: null,
        journalEntryId: null,
        nextRunDate: null,
        ended: false,
        error: 'Template not found.',
      };
    }
    const tpl = mapRecurringTemplateRow(tplRow as Row);
    const runDate = onDate ?? tpl.nextRunDate;

    // Compute the advanced cursor up front (pure), then CLAIM this period atomically: the
    // conditional update only succeeds for the run that flips next_run_date away from
    // runDate, so two concurrent/double-fired runs cannot both post a document for the
    // same period (idempotency). The loser of the race posts nothing.
    const advanced = advanceSchedule({
      frequency: tpl.frequency,
      intervalCount: tpl.intervalCount,
      startDate: tpl.startDate,
      endDate: tpl.endDate,
      nextRunDate: runDate,
      dayOfMonth: tpl.dayOfMonth,
    });
    const { data: claimed, error: claimErr } = await acct()
      .from('recurring_templates')
      .update({ next_run_date: advanced.nextRunDate ?? advanced.ranDate })
      .eq('id', id)
      .eq('next_run_date', runDate)
      .select('id');
    if (claimErr) {
      return fail(tpl, `Could not claim the period: ${claimErr.message}`);
    }
    if (!claimed || claimed.length === 0) {
      // Another run already advanced past this period — do not post a duplicate.
      return {
        templateId: id,
        generatedId: null,
        journalEntryId: null,
        nextRunDate: tpl.nextRunDate,
        ended: false,
        error: 'Already generated for this period.',
      };
    }

    // We own the period (the cursor is already advanced). Post the document; on ANY
    // failure roll the claim back so the period can be retried rather than skipped.
    let generatedId: string | null = null;
    let journalEntryId: string | null = null;
    try {
      if (tpl.kind === 'invoice') {
        const input = buildRecurringInvoiceInput(tpl.payload as RecurringInvoicePayload, runDate);
        const created = await invoicesService.createDraft(input);
        if (!created.invoice)
          throw new Error(created.error ?? 'Failed to create the recurring invoice.');
        generatedId = created.invoice.id;
        const sent = await invoicesService.send(generatedId);
        if (!sent.invoice) {
          // The draft exists but could not post — void it so no unposted draft leaks.
          await invoicesService.voidInvoice(generatedId, 'Recurring generation failed to post');
          throw new Error(sent.error ?? 'Failed to post the recurring invoice.');
        }
        journalEntryId = sent.invoice.journalEntryId;
      } else if (tpl.kind === 'bill') {
        const input = buildRecurringBillInput(tpl.payload as RecurringBillPayload, runDate);
        const created = await billsService.createDraft(input);
        if (!created.bill) throw new Error(created.error ?? 'Failed to create the recurring bill.');
        generatedId = created.bill.id;
        const posted = await billsService.post(generatedId);
        if (!posted.bill) {
          await billsService.voidBill(generatedId, 'Recurring generation failed to post');
          throw new Error(posted.error ?? 'Failed to post the recurring bill.');
        }
        journalEntryId = posted.bill.journalEntryId;
      } else {
        // journal kind: post the explicit balanced lines directly.
        const lines = buildRecurringJournalLines(tpl.payload as RecurringJournalPayload);
        const posted = await journalService.createAndPost({
          entryDate: runDate,
          memo: (tpl.payload as RecurringJournalPayload).memo ?? `Recurring: ${tpl.name}`,
          sourceType: 'manual',
          lines,
        });
        if (!posted.entryId)
          throw new Error(posted.error ?? 'Failed to post the recurring journal entry.');
        generatedId = posted.entryId;
        journalEntryId = posted.entryId;
      }
    } catch (e) {
      // Best-effort rollback of the period claim so this period isn't silently skipped.
      try {
        await acct().from('recurring_templates').update({ next_run_date: runDate }).eq('id', id);
      } catch {
        /* leave the advanced cursor; the failure below is the actionable error */
      }
      return fail(
        tpl,
        e instanceof Error ? e.message : 'Failed to generate the recurring document.'
      );
    }

    // Document posted; the claim already advanced next_run_date. Persist the remaining
    // bookkeeping columns (do NOT re-write next_run_date — the claim owns it).
    try {
      const { error: uErr } = await acct()
        .from('recurring_templates')
        .update({
          last_run_date: advanced.ranDate,
          last_generated_id: generatedId,
          occurrences_generated: tpl.occurrencesGenerated + 1,
          active: advanced.ended ? false : tpl.active,
        })
        .eq('id', id);

      return {
        templateId: id,
        generatedId,
        journalEntryId,
        nextRunDate: advanced.nextRunDate,
        ended: advanced.ended,
        // The document posted; only the bookkeeping write failed. Surface it but don't claim failure.
        error: uErr ? `Posted, but advancing the schedule failed: ${uErr.message}` : undefined,
      };
    } catch (e) {
      // The document DID post; only persisting the bookkeeping advance threw. Surface it as
      // a result (not a propagated rejection) so generateAllDue's batch isn't aborted.
      return {
        templateId: id,
        generatedId,
        journalEntryId,
        nextRunDate: advanced.nextRunDate,
        ended: advanced.ended,
        error: `Posted, but advancing the schedule failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      };
    }
  },

  /**
   * Generate every template due as of `asOf` (default today), one at a time, advancing
   * each cursor by exactly one period. Each template generates AT MOST one document per
   * call — a template that is several periods overdue catches up one run per invocation,
   * which prevents a paused-then-resumed template from posting a burst of back-dated
   * documents. Returns one GenerateResult per attempted template (including failures).
   */
  async generateAllDue(asOf: string = todayISO()): Promise<GenerateResult[]> {
    const due = await this.listDue(asOf);
    const results: GenerateResult[] = [];
    for (const tpl of due) {
      // Generate as of the template's own next_run_date (its scheduled date), not asOf,
      // so the document carries its proper period date.
      try {
        results.push(await this.generateDue(tpl.id, tpl.nextRunDate));
      } catch (e) {
        // One template throwing unexpectedly must not abort the rest of the batch.
        results.push({
          templateId: tpl.id,
          generatedId: null,
          journalEntryId: null,
          nextRunDate: tpl.nextRunDate,
          ended: false,
          error: e instanceof Error ? e.message : 'Failed to generate.',
        });
      }
    }
    return results;
  },
};

/** Shape a failed generation (no document posted, cursor untouched). */
function fail(tpl: RecurringTemplate, error: string): GenerateResult {
  return {
    templateId: tpl.id,
    generatedId: null,
    journalEntryId: null,
    nextRunDate: tpl.nextRunDate, // unchanged — safe to retry
    ended: false,
    error,
  };
}
