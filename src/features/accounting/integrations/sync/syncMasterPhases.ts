/**
 * QBO sync — MASTERS phases (chart of accounts, items, customers, vendors).
 *
 * First run adopts the existing rows (the CSV-imported chart/parties) by their
 * natural keys — account number/name, item name, party display name — and stamps
 * external_qbo_id; re-runs match by external_qbo_id and refresh mutable fields.
 * Adoption is by QBO's unique DisplayName ONLY for parties — email is deliberately
 * NOT a match key (the live masters contain shared emails across different people).
 */
import { accountsService } from '../../../../services/api/accounting/accounts';
import { customersService } from '../../../../services/api/accounting/customers';
import { itemsService } from '../../../../services/api/accounting/items';
import { vendorsService } from '../../../../services/api/accounting/vendors';
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import { mapQboAccount, mapQboCustomer, mapQboItem, mapQboVendor } from './qboApiMappers';
import {
  nameKey,
  zeroCounts,
  type PageOutcome,
  type SyncContext,
  type SyncLogLine,
  type SyncPhase,
} from './syncShared';

const accountsPhase: SyncPhase = {
  key: 'accounts',
  label: 'Chart of accounts',
  entity: 'Account',
  pageSize: 1000,
  includeInactive: true,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];

    for (const json of records) {
      const mapped = mapQboAccount(json);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.accounts.byQboId.get(mapped.qboId);
      if (existingByQbo) {
        // Re-run: refresh the mutable fields.
        const updated = await accountsService.update(existingByQbo, {
          name: mapped.input.name,
          accountNumber: mapped.input.accountNumber,
          description: mapped.input.description,
          isActive: mapped.active,
        });
        if (updated) counts.updated += 1;
        else {
          counts.failed += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.name}"`,
            recordId: existingByQbo,
          });
        }
        continue;
      }

      // First run: adopt the existing chart (CSV-imported) by number, then by name —
      // stamp the QBO id without rewriting its classification.
      const adoptId =
        (mapped.accountNumber ? ctx.accounts.byNumber.get(mapped.accountNumber) : undefined) ??
        ctx.accounts.byName.get(nameKey(mapped.name));
      if (adoptId) {
        const adopted = await accountsService.update(adoptId, {
          externalQboId: mapped.qboId,
          isActive: mapped.active,
        });
        if (adopted) {
          ctx.accounts.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'update',
            message: `Matched existing account "${mapped.name}"`,
            recordId: adoptId,
          });
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Could not stamp existing account "${mapped.name}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await accountsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await accountsService.setActive(created.id, false);
        ctx.accounts.byQboId.set(mapped.qboId, created.id);
        if (mapped.accountNumber) ctx.accounts.byNumber.set(mapped.accountNumber, created.id);
        ctx.accounts.byName.set(nameKey(mapped.name), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.name,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.name}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const itemsPhase: SyncPhase = {
  key: 'items',
  label: 'Products & services',
  entity: 'Item',
  pageSize: 1000,
  includeInactive: true,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const resolveAccountId = (qboAccountId: string | null) =>
      qboAccountId ? (ctx.accounts.byQboId.get(qboAccountId) ?? null) : null;

    for (const json of records) {
      const mapped = mapQboItem(json, resolveAccountId);
      if (!mapped.input) {
        // Category rows are expected non-items — count as skipped, not failed.
        const benign = mapped.problem?.startsWith('Category');
        if (benign) counts.skipped += 1;
        else {
          counts.failed += 1;
          logs.push({
            entity: 'Item',
            qboId: mapped.qboId || null,
            action: 'error',
            status: 'error',
            message: mapped.problem,
          });
        }
        continue;
      }

      // The document phases resolve line accounts off this lookup entry.
      const info = {
        itemType: mapped.input.itemType ?? 'service',
        incomeAccountId: mapped.input.incomeAccountId ?? null,
        expenseAccountId: mapped.input.expenseAccountId ?? null,
        inventoryAssetAccountId: mapped.input.inventoryAssetAccountId ?? null,
      };

      const existingByQbo = ctx.items.byQboId.get(mapped.qboId)?.id;
      const adoptId = existingByQbo ?? ctx.items.byName.get(nameKey(mapped.name));
      if (adoptId) {
        const updated = await itemsService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated) {
          ctx.items.byQboId.set(mapped.qboId, { id: adoptId, ...info });
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Item',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing item "${mapped.name}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Item',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.name}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await itemsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await itemsService.update(created.id, { isActive: false });
        ctx.items.byQboId.set(mapped.qboId, { id: created.id, ...info });
        ctx.items.byName.set(nameKey(mapped.name), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Item',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.name,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Item',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.name}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const customersPhase: SyncPhase = {
  key: 'customers',
  label: 'Customers',
  entity: 'Customer',
  pageSize: 1000,
  includeInactive: true,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const termName = (id: string | null) => (id ? (ctx.termNames.get(id) ?? null) : null);

    for (const json of records) {
      const mapped = mapQboCustomer(json, termName);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.customers.byQboId.get(mapped.qboId);
      const adoptId = existingByQbo ?? ctx.customers.byName.get(nameKey(mapped.displayName));
      if (adoptId) {
        const updated = await customersService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated.customer) {
          ctx.customers.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Customer',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing customer "${mapped.displayName}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Customer',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.displayName}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await customersService.create(mapped.input);
      if (created) {
        if (!mapped.active) await customersService.update(created.id, { isActive: false });
        ctx.customers.byQboId.set(mapped.qboId, created.id);
        ctx.customers.byName.set(nameKey(mapped.displayName), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.displayName,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.displayName}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const vendorsPhase: SyncPhase = {
  key: 'vendors',
  label: 'Vendors',
  entity: 'Vendor',
  pageSize: 1000,
  includeInactive: true,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const termName = (id: string | null) => (id ? (ctx.termNames.get(id) ?? null) : null);

    for (const json of records) {
      const mapped = mapQboVendor(json, termName);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.vendors.byQboId.get(mapped.qboId);
      const adoptId = existingByQbo ?? ctx.vendors.byName.get(nameKey(mapped.displayName));
      if (adoptId) {
        const updated = await vendorsService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated) {
          ctx.vendors.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Vendor',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing vendor "${mapped.displayName}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Vendor',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.displayName}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await vendorsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await vendorsService.update(created.id, { isActive: false });
        ctx.vendors.byQboId.set(mapped.qboId, created.id);
        ctx.vendors.byName.set(nameKey(mapped.displayName), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.displayName,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.displayName}"`,
        });
      }
    }

    return { counts, logs };
  },
};

/** Masters phases, in dependency order (accounts feed item account refs). */
export const MASTER_PHASES: SyncPhase[] = [accountsPhase, itemsPhase, customersPhase, vendorsPhase];
