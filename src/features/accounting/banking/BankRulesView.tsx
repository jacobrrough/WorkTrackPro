import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { useBankAccount, useBankRules, useAccounts } from '../hooks/useAccountingQueries';
import {
  useCreateBankRule,
  useDeleteBankRule,
  useUpdateBankRule,
} from '../hooks/useAccountingMutations';
import { BANKING_BASE } from '../constants';
import {
  BANK_RULE_FIELD_LABELS,
  BANK_RULE_OP_LABELS,
  type BankRule,
  type BankRuleField,
  type BankRuleOp,
  type NewBankRuleInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const FIELDS = Object.keys(BANK_RULE_FIELD_LABELS) as BankRuleField[];
const OPS = Object.keys(BANK_RULE_OP_LABELS) as BankRuleOp[];

/** Ops valid for the amount field are numeric comparisons; text fields use the rest. */
const AMOUNT_OPS: BankRuleOp[] = ['gt', 'lt', 'equals'];
const TEXT_OPS: BankRuleOp[] = ['contains', 'equals', 'regex'];

function opsForField(field: BankRuleField): BankRuleOp[] {
  return field === 'amount' ? AMOUNT_OPS : TEXT_OPS;
}

interface RuleDraft {
  matchField: BankRuleField;
  matchOp: BankRuleOp;
  matchValue: string;
  setAccountId: string;
  priority: number;
  scopeAll: boolean;
}

function draftFromRule(rule: BankRule): RuleDraft {
  return {
    matchField: rule.matchField ?? 'description',
    matchOp: rule.matchOp ?? 'contains',
    matchValue: rule.matchValue ?? '',
    setAccountId: rule.setAccountId ?? '',
    priority: rule.priority,
    // Scope is "all accounts" when the rule has no bank account binding; otherwise
    // it is bound to this page's account.
    scopeAll: rule.bankAccountId == null,
  };
}

/** Create / edit dialog for a single bank rule. Server-side validateRule gates saves. */
function RuleEditorModal({
  rule,
  bankAccountId,
  onClose,
}: {
  rule: BankRule | null;
  bankAccountId: string | undefined;
  onClose: () => void;
}) {
  const create = useCreateBankRule();
  const update = useUpdateBankRule();
  const [draft, setDraft] = useState<RuleDraft>(
    rule
      ? draftFromRule(rule)
      : {
          matchField: 'description',
          matchOp: 'contains',
          matchValue: '',
          setAccountId: '',
          priority: 0,
          scopeAll: !bankAccountId,
        }
  );
  const [error, setError] = useState<string | null>(null);

  const isAmount = draft.matchField === 'amount';
  const validOps = opsForField(draft.matchField);

  const patch = (p: Partial<RuleDraft>) => setDraft((prev) => ({ ...prev, ...p }));

  const onFieldChange = (field: BankRuleField) => {
    const ops = opsForField(field);
    patch({ matchField: field, matchOp: ops.includes(draft.matchOp) ? draft.matchOp : ops[0] });
  };

  const submit = async () => {
    setError(null);
    if (!draft.matchValue.trim()) {
      setError('Enter a value to match against.');
      return;
    }
    if (!draft.setAccountId) {
      setError('Choose the category account this rule assigns.');
      return;
    }
    // Scope: when "all accounts" is off, the rule is bound to this page's account.
    const scopedAccountId = draft.scopeAll ? null : bankAccountId ?? null;

    if (rule) {
      const res = await update.mutateAsync({
        id: rule.id,
        input: {
          bankAccountId: scopedAccountId,
          matchField: draft.matchField,
          matchOp: draft.matchOp,
          matchValue: draft.matchValue.trim(),
          setAccountId: draft.setAccountId,
          priority: draft.priority,
        },
      });
      if (res.error || !res.rule) {
        setError(res.error ?? 'Could not save the rule.');
        return;
      }
    } else {
      const input: NewBankRuleInput = {
        bankAccountId: scopedAccountId,
        matchField: draft.matchField,
        matchOp: draft.matchOp,
        matchValue: draft.matchValue.trim(),
        setAccountId: draft.setAccountId,
        priority: draft.priority,
      };
      const res = await create.mutateAsync(input);
      if (res.error || !res.rule) {
        setError(res.error ?? 'Could not create the rule.');
        return;
      }
    }
    onClose();
  };

  const busy = create.isPending || update.isPending;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{rule ? 'Edit Rule' : 'New Rule'}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-slate-400">
          When a transaction matches, it is auto-categorized to the chosen account. Higher priority
          wins when several rules match.
        </p>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="When" htmlFor="rule-field">
              <select
                id="rule-field"
                className={inputClass}
                value={draft.matchField}
                onChange={(e) => onFieldChange(e.target.value as BankRuleField)}
              >
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {BANK_RULE_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Condition" htmlFor="rule-op">
              <select
                id="rule-op"
                className={inputClass}
                value={draft.matchOp}
                onChange={(e) => patch({ matchOp: e.target.value as BankRuleOp })}
              >
                {OPS.filter((o) => validOps.includes(o)).map((o) => (
                  <option key={o} value={o}>
                    {BANK_RULE_OP_LABELS[o]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField
            label="Value"
            htmlFor="rule-value"
            required
            hint={
              isAmount
                ? 'A dollar amount; compared to the transaction magnitude.'
                : draft.matchOp === 'regex'
                  ? 'A regular expression (invalid patterns never match).'
                  : 'Text to look for in the chosen field.'
            }
          >
            <input
              id="rule-value"
              className={inputClass}
              value={draft.matchValue}
              onChange={(e) => patch({ matchValue: e.target.value })}
              inputMode={isAmount ? 'decimal' : 'text'}
              placeholder={isAmount ? '100.00' : 'e.g. SHELL'}
            />
          </FormField>

          <FormField label="Categorize to" htmlFor="rule-account" required>
            <AccountPicker
              id="rule-account"
              ariaLabel="Category account"
              value={draft.setAccountId}
              onChange={(id) => patch({ setAccountId: id })}
            />
          </FormField>

          <div className="grid grid-cols-2 items-end gap-3">
            <FormField label="Priority" htmlFor="rule-priority" hint="Higher wins">
              <input
                id="rule-priority"
                type="number"
                className={`${inputClass} text-right`}
                value={draft.priority}
                onChange={(e) => patch({ priority: Number.parseInt(e.target.value, 10) || 0 })}
              />
            </FormField>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={draft.scopeAll}
                disabled={!bankAccountId}
                onChange={(e) => patch({ scopeAll: e.target.checked })}
                className="size-4 accent-primary"
              />
              Apply to all accounts
            </label>
          </div>

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
              {busy ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  accountName,
  onEdit,
}: {
  rule: BankRule;
  accountName: string;
  onEdit: () => void;
}) {
  const update = useUpdateBankRule();
  const remove = useDeleteBankRule();
  const busy = update.isPending || remove.isPending;

  const onToggleActive = () =>
    update.mutate({ id: rule.id, input: { isActive: !rule.isActive } });

  const onDelete = () => {
    if (window.confirm('Delete this rule? Transactions already categorized are unaffected.')) {
      remove.mutate(rule.id);
    }
  };

  const fieldLabel = rule.matchField ? BANK_RULE_FIELD_LABELS[rule.matchField] : 'Field';
  const opLabel = rule.matchOp ? BANK_RULE_OP_LABELS[rule.matchOp] : '';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-8 shrink-0 text-center font-mono text-xs text-slate-500">
        {rule.priority}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${rule.isActive ? 'text-white' : 'text-slate-500'}`}>
          {fieldLabel} {opLabel}{' '}
          <span className="font-mono text-slate-300">{rule.matchValue}</span>
          {' → '}
          <span className="text-primary">{accountName}</span>
        </span>
        <span className="block text-xs text-slate-500">
          {rule.bankAccountId == null ? 'All accounts' : 'This account'}
          {!rule.isActive && ' · inactive'}
        </span>
      </span>
      <button
        type="button"
        onClick={onToggleActive}
        disabled={busy}
        aria-label={rule.isActive ? 'Deactivate rule' : 'Activate rule'}
        className="flex size-9 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">
          {rule.isActive ? 'toggle_on' : 'toggle_off'}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        aria-label="Edit rule"
        className="flex size-9 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">edit</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Delete rule"
        className="flex size-9 items-center justify-center rounded-sm text-slate-500 hover:bg-white/10 hover:text-red-400 disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">delete</span>
      </button>
    </div>
  );
}

export default function BankRulesView() {
  const { bankAccountId } = useParams<{ bankAccountId: string }>();
  const navigate = useNavigate();
  const { data: account } = useBankAccount(bankAccountId);
  const { data: rules = [], isPending, isError } = useBankRules(bankAccountId);
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<BankRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const accountName = (id: string | null): string => {
    if (!id) return 'Uncategorized';
    const a = accounts.find((x) => x.id === id);
    return a ? a.name : 'Unknown account';
  };

  return (
    <AccountingShell
      active="banking"
      title="Categorization Rules"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
          New rule
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(`${BANKING_BASE}/${bankAccountId}`)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {account ? account.name : 'Back to account'}
        </button>

        <p className="text-sm text-slate-400">
          Rules run when transactions are imported and auto-fill the category. Higher-priority rules
          win; the first match sets the category for review. Rules scoped to all accounts also apply
          here.
        </p>

        {isPending && <p className="text-slate-400">Loading rules…</p>}
        {isError && <p className="text-red-400">Could not load rules.</p>}

        {!isPending && !isError && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">rule</span>
            <p className="text-lg font-bold text-white">No rules yet</p>
            <p className="max-w-sm text-sm text-slate-400">
              Create a rule to auto-categorize matching transactions on import — for example, a
              description containing “SHELL” to your Fuel expense account.
            </p>
            <Button size="sm" icon="add" onClick={() => setShowCreate(true)}>
              New rule
            </Button>
          </div>
        )}

        {rules.length > 0 && (
          <>
            <div className="flex items-center gap-3 px-3 text-xs font-semibold uppercase text-slate-500">
              <span className="w-8 shrink-0 text-center">Pri</span>
              <span className="flex-1">Rule</span>
              <span className="w-[120px] shrink-0 text-right">Actions</span>
            </div>
            <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  accountName={accountName(rule.setAccountId)}
                  onEdit={() => setEditing(rule)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <RuleEditorModal rule={null} bankAccountId={bankAccountId} onClose={() => setShowCreate(false)} />
      )}
      {editing && (
        <RuleEditorModal
          rule={editing}
          bankAccountId={bankAccountId}
          onClose={() => setEditing(null)}
        />
      )}
    </AccountingShell>
  );
}
