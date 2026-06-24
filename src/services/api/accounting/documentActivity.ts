import { acct } from './accountingClient';

/**
 * QuickBooks-style audit history + sent-version state for accounting documents.
 *
 * Both are computed server-side (accounting.document_timeline / document_sent_state) so the
 * assembly + hashing logic lives in one place; this service just calls the RPCs and narrows the
 * jsonb results. Read-only — nothing here mutates.
 */

/** Documents that have an audit timeline. */
export type ActivityDocType = 'invoice' | 'estimate' | 'bill';
/** Documents that are sent to a customer (so "current version sent?" applies). */
export type SentDocType = 'invoice' | 'estimate';

/** One normalized event in a document's audit history (newest first). */
export interface DocumentTimelineEvent {
  /** ISO timestamp. */
  at: string;
  /** The acting user's email, or null for system/cron actions. */
  actor: string | null;
  /** Event class — drives the icon: created | edited | status | version | email | payment | deleted. */
  kind: string;
  /** Headline, e.g. "Edited", "Emailed to a@b.com (sent)", "Status → void". */
  title: string;
  /** Secondary line: changed fields, amount, "current version"/"older copy", etc. */
  detail: string | null;
}

/** Whether the customer holds the current version of a document. */
export interface DocumentSentState {
  /** Has the document ever been sent/issued? */
  issued: boolean;
  /** Does the last-sent content match the live content? (false ⇒ "edited since sent".) */
  isCurrent: boolean;
  lastSentAt: string | null;
  sentCount: number;
  /** The pinned snapshot of exactly what was last sent (for "view sent copy"). */
  lastSentSnapshotId: string | null;
}

export const documentActivityService = {
  /** Assemble the audit timeline for one document (newest first). */
  async timeline(docType: ActivityDocType, docId: string): Promise<DocumentTimelineEvent[]> {
    const { data, error } = await acct().rpc('document_timeline', {
      p_type: docType,
      p_id: docId,
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((r): DocumentTimelineEvent => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        at: String(o.at ?? ''),
        actor: o.actor == null ? null : String(o.actor),
        kind: String(o.kind ?? 'edited'),
        title: String(o.title ?? ''),
        detail: o.detail == null ? null : String(o.detail),
      };
    });
  },

  /** Compute the sent-version state for the badge (null when the document doesn't exist). */
  async sentState(docType: SentDocType, docId: string): Promise<DocumentSentState | null> {
    const { data, error } = await acct().rpc('document_sent_state', {
      p_type: docType,
      p_id: docId,
    });
    if (error) throw error;
    if (data == null) return null;
    const o = data as Record<string, unknown>;
    return {
      issued: o.issued === true,
      isCurrent: o.isCurrent === true,
      lastSentAt: o.lastSentAt == null ? null : String(o.lastSentAt),
      sentCount: typeof o.sentCount === 'number' ? o.sentCount : Number(o.sentCount ?? 0),
      lastSentSnapshotId: o.lastSentSnapshotId == null ? null : String(o.lastSentSnapshotId),
    };
  },
};
