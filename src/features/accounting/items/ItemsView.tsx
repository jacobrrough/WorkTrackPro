import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { formatMoney } from '../accountingViewModel';
import { useAccounts, useItems, useTaxCodes } from '../hooks/useAccountingQueries';
import { useCreateItem, useUpdateItem } from '../hooks/useAccountingMutations';
import {
  ITEM_TYPES,
  ITEM_TYPE_LABELS,
  type Account,
  type Item,
  type ItemType,
  type NewItemInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

interface ItemDraft {
  name: string;
  sku: string;
  itemType: ItemType;
  incomeAccountId: string;
  expenseAccountId: string;
  defaultTaxCodeId: string;
  salesPrice: number;
  purchaseCost: number;
  isActive: boolean;
}

function draftFromItem(i: Item): ItemDraft {
  return {
    name: i.name,
    sku: i.sku ?? '',
    itemType: i.itemType,
    incomeAccountId: i.incomeAccountId ?? '',
    expenseAccountId: i.expenseAccountId ?? '',
    defaultTaxCodeId: i.defaultTaxCodeId ?? '',
    salesPrice: i.salesPrice ?? 0,
    purchaseCost: i.purchaseCost ?? 0,
    isActive: i.isActive,
  };
}

const EMPTY_DRAFT: ItemDraft = {
  name: '',
  sku: '',
  itemType: 'service',
  incomeAccountId: '',
  expenseAccountId: '',
  defaultTaxCodeId: '',
  salesPrice: 0,
  purchaseCost: 0,
  isActive: true,
};

/**
 * Create / edit dialog for one product or service. On create the row is inserted active; on
 * edit the active toggle is the soft-delete reversal (there is no hard delete — items may be
 * referenced by historical invoice/estimate/bill lines).
 */
function ItemEditorModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const { data: taxCodes = [] } = useTaxCodes();
  const [draft, setDraft] = useState<ItemDraft>(item ? draftFromItem(item) : EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<ItemDraft>) => setDraft((prev) => ({ ...prev, ...p }));
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    const name = draft.name.trim();
    if (!name) {
      setError('Give this product or service a name.');
      return;
    }
    const common = {
      name,
      sku: draft.sku.trim() || null,
      itemType: draft.itemType,
      incomeAccountId: draft.incomeAccountId || null,
      expenseAccountId: draft.expenseAccountId || null,
      defaultTaxCodeId: draft.defaultTaxCodeId || null,
      salesPrice: draft.salesPrice || null,
      purchaseCost: draft.purchaseCost || null,
    };
    if (item) {
      const res = await update.mutateAsync({
        id: item.id,
        input: { ...common, isActive: draft.isActive },
      });
      if (!res) {
        setError('Could not save the product or service.');
        return;
      }
    } else {
      const input: NewItemInput = common;
      const res = await create.mutateAsync(input);
      if (!res) {
        setError('Could not create the product or service.');
        return;
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {item ? 'Edit product or service' : 'New product or service'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <FormField label="Name" htmlFor="item-name" required>
            <input
              id="item-name"
              className={inputClass}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Labor, Delivery, Material"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="item-type">
              <select
                id="item-type"
                className={inputClass}
                value={draft.itemType}
                onChange={(e) => patch({ itemType: e.target.value as ItemType })}
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="SKU" htmlFor="item-sku" hint="Optional.">
              <input
                id="item-sku"
                className={inputClass}
                value={draft.sku}
                onChange={(e) => patch({ sku: e.target.value })}
                placeholder="Optional"
              />
            </FormField>
          </div>

          <FormField
            label="Income account"
            htmlFor="item-income"
            hint="Revenue from this item posts here when the invoice is sent."
          >
            <AccountPicker
              id="item-income"
              ariaLabel="Income account"
              value={draft.incomeAccountId}
              onChange={(id) => patch({ incomeAccountId: id })}
              accountTypes={['income']}
              placeholder="Use default sales income"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Sales price / rate" htmlFor="item-price" hint="Seeds the line rate.">
              <CurrencyInput
                id="item-price"
                aria-label="Sales price"
                value={draft.salesPrice}
                onValueChange={(v) => patch({ salesPrice: v })}
              />
            </FormField>

            <FormField label="Default tax code" htmlFor="item-tax" hint="Optional.">
              <select
                id="item-tax"
                className={inputClass}
                value={draft.defaultTaxCodeId}
                onChange={(e) => patch({ defaultTaxCodeId: e.target.value })}
              >
                <option value="">None (use document)</option>
                {taxCodes.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <details className="rounded-sm border border-white/10 bg-background-dark/40 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-muted">
              Purchasing (optional)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FormField label="Expense account" htmlFor="item-expense">
                <AccountPicker
                  id="item-expense"
                  ariaLabel="Expense account"
                  value={draft.expenseAccountId}
                  onChange={(id) => patch({ expenseAccountId: id })}
                  accountTypes={['expense', 'asset']}
                  placeholder="None"
                />
              </FormField>
              <FormField label="Purchase cost" htmlFor="item-cost">
                <CurrencyInput
                  id="item-cost"
                  aria-label="Purchase cost"
                  value={draft.purchaseCost}
                  onValueChange={(v) => patch({ purchaseCost: v })}
                />
              </FormField>
            </div>
          </details>

          {item && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => patch({ isActive: e.target.checked })}
                className="size-4 accent-primary"
              />
              Active (available in the line-item picker)
            </label>
          )}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : item ? 'Save' : 'Add product or service'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  accountLabel,
  onEdit,
}: {
  item: Item;
  accountLabel: string | null;
  onEdit: () => void;
}) {
  const update = useUpdateItem();
  const onToggle = () => update.mutate({ id: item.id, input: { isActive: !item.isActive } });

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${item.isActive ? 'text-white' : 'text-subtle'}`}>
          {item.name}
          {!item.isActive && ' · inactive'}
        </span>
        <span className="block truncate text-xs text-subtle">
          {ITEM_TYPE_LABELS[item.itemType]}
          {accountLabel ? ` · ${accountLabel}` : ' · no income account'}
          {item.salesPrice ? ` · ${formatMoney(item.salesPrice)}` : ''}
        </span>
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={update.isPending}
        aria-label={item.isActive ? 'Deactivate' : 'Reactivate'}
        title={item.isActive ? 'Deactivate' : 'Reactivate'}
        className="flex size-9 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">
          {item.isActive ? 'toggle_on' : 'toggle_off'}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit"
        className="flex size-9 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
      >
        <span className="material-symbols-outlined text-lg">edit</span>
      </button>
    </div>
  );
}

/**
 * Products & Services master admin (accounting.items). CRUD for the sellable/purchasable
 * catalog — Labor, Delivery, Material, etc. — each mapped to an income account so a line
 * that bills the item posts its revenue to the right GL account (e.g. 4030 Sales, Labor).
 * The whole accounting module is AdminGuard-gated, so this screen is admin-only. The
 * "show inactive" toggle reveals soft-deleted items for reactivation.
 */
export default function ItemsView() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: items = [], isPending, isError } = useItems(showInactive);
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);

  const accountLabel = useMemo(() => {
    const byId = new Map<string, Account>(accounts.map((a) => [a.id, a]));
    return (id: string | null): string | null => {
      if (!id) return null;
      const a = byId.get(id);
      if (!a) return null;
      return a.accountNumber ? `${a.accountNumber} · ${a.name}` : a.name;
    };
  }, [accounts]);

  return (
    <AccountingShell active="items" title="Products & services">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xl text-sm text-muted">
            Products and services are the things you put on invoices and estimates — Labor,
            Delivery, Material, and so on. Each one maps to an income account, so when you bill it
            the revenue posts to the right account automatically. Parts are picked separately.
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="size-4 accent-primary"
              />
              Show inactive
            </label>
            <Button size="sm" icon="add" onClick={() => setCreating(true)}>
              New
            </Button>
          </div>
        </div>

        {isPending && <p className="text-muted">Loading products &amp; services…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load products &amp; services. Confirm the accounting schema is exposed and you
            have an accounting role.
          </p>
        )}

        {!isPending && !isError && items.length === 0 && (
          <p className="rounded-sm border border-dashed border-white/15 px-3 py-6 text-center text-sm text-subtle">
            No products or services yet. Add Labor, Delivery, Material, and anything else you bill.
          </p>
        )}

        {!isPending && !isError && items.length > 0 && (
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {items.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                accountLabel={accountLabel(i.incomeAccountId)}
                onEdit={() => setEditing(i)}
              />
            ))}
          </div>
        )}
      </div>

      {creating && <ItemEditorModal item={null} onClose={() => setCreating(false)} />}
      {editing && <ItemEditorModal item={editing} onClose={() => setEditing(null)} />}
    </AccountingShell>
  );
}
