import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { REPORTS_BASE, accountLedgerPath } from '../constants';

/**
 * #3 — General-ledger landing. Pick a chart-of-accounts account to open its register
 * (the running-balance transaction detail). This is the unscoped entry point; the report
 * drill-down links (Trial Balance / P&L / Balance Sheet account rows) deep-link straight
 * into a specific account's register via AccountLink, bypassing this picker.
 */
export default function GeneralLedgerView() {
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState('');

  return (
    <AccountingShell active="reports" title="General Ledger">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          type="button"
          onClick={() => navigate(REPORTS_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All reports
        </button>

        <div>
          <h2 className="text-xl font-bold text-white">General Ledger</h2>
          <p className="text-sm text-slate-400">
            Pick an account to see every posted transaction and its running balance.
          </p>
        </div>

        <TaxDisclaimer />

        <div className="flex flex-col gap-2 rounded-sm border border-white/10 bg-card-dark p-3">
          <label
            htmlFor="gl-account"
            className="text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Account
          </label>
          <AccountPicker
            id="gl-account"
            ariaLabel="General ledger account"
            value={accountId}
            onChange={(id) => {
              setAccountId(id);
              if (id) navigate(accountLedgerPath(id));
            }}
          />
        </div>
      </div>
    </AccountingShell>
  );
}
