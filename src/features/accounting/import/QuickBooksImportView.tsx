import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';

interface ImporterCard {
  step: number;
  key: string;
  title: string;
  description: string;
  icon: string;
  iconClass: string;
  path: string;
}

const IMPORTERS: ImporterCard[] = [
  {
    step: 1,
    key: 'accounts',
    title: 'Chart of Accounts',
    description: 'Your accounts. Everything else maps onto these, so import them first.',
    icon: 'account_tree',
    iconClass: 'text-emerald-400',
    path: '/app/accounting/import/accounts',
  },
  {
    step: 2,
    key: 'customers',
    title: 'Customers',
    description: 'Your customer list, for accounts receivable and invoices.',
    icon: 'groups',
    iconClass: 'text-sky-400',
    path: '/app/accounting/import/customers',
  },
  {
    step: 3,
    key: 'vendors',
    title: 'Vendors',
    description: 'Your vendor / supplier list, for accounts payable and bills.',
    icon: 'local_shipping',
    iconClass: 'text-violet-400',
    path: '/app/accounting/import/vendors',
  },
  {
    step: 4,
    key: 'transactions',
    title: 'Transaction history',
    description:
      'Your full general-ledger history from QuickBooks, posted as balanced journal entries.',
    icon: 'receipt_long',
    iconClass: 'text-amber-400',
    path: '/app/accounting/import/transactions',
  },
];

export default function QuickBooksImportView() {
  const navigate = useNavigate();

  return (
    <AccountingShell active="import" title="Import from QuickBooks">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-md border border-white/10 bg-card-dark p-4 text-sm text-slate-300">
          <p>
            Move your books over from <strong>QuickBooks Online</strong>. Each importer takes a CSV
            you export from QuickBooks, lets you preview and map it, and only writes what you
            confirm. Work top to bottom — later steps reference the earlier ones.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {IMPORTERS.map((imp) => (
            <button
              key={imp.key}
              type="button"
              onClick={() => navigate(imp.path)}
              className="flex items-start gap-3 rounded-md border border-white/10 bg-card-dark p-4 text-left transition-colors hover:border-primary/40 hover:bg-white/5"
            >
              <span className={`material-symbols-outlined text-3xl ${imp.iconClass}`}>
                {imp.icon}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step {imp.step}
                  </span>
                </span>
                <span className="block font-bold text-white">{imp.title}</span>
                <span className="mt-0.5 block text-sm text-slate-400">{imp.description}</span>
              </span>
              <span className="material-symbols-outlined text-slate-500">chevron_right</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          Tip: re-running any importer is safe — records that already exist
          (accounts/customers/vendors by name, transactions by content) are skipped rather than
          duplicated.
        </p>
      </div>
    </AccountingShell>
  );
}
