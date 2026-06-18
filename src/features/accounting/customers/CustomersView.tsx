import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { LIST_CONTAINER, LIST_HEADER, LIST_ROW } from '../components/listRowStyles';
import { useCustomers } from '../hooks/useAccountingQueries';
import { CUSTOMERS_BASE } from '../constants';

/**
 * Customers hub — list every customer with a quick search, click through to one customer's
 * full AR picture (CustomerDetailView). Includes inactive customers (badged) so they stay
 * findable. Read/scope only; customers are created by the proposal→customer bridge or the
 * invoice/estimate flows.
 */
export default function CustomersView() {
  const navigate = useNavigate();
  const { data: customers = [], isPending, isError } = useCustomers(true);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.displayName, c.companyName, c.contactName, c.email, c.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [customers, search]);

  return (
    <AccountingShell active="customers" title="Customers">
      {isPending && <p className="text-slate-400">Loading customers…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load customers. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && customers.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">group</span>
          <p className="text-lg font-bold text-white">No customers yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Customers appear here once a proposal is accepted or an invoice/estimate is created for
            them.
          </p>
        </div>
      )}

      {customers.length > 0 && (
        <>
          <div className="mb-2">
            <input
              type="search"
              aria-label="Search customers"
              placeholder="Search name, company, email, phone…"
              className="w-full rounded-sm border border-white/10 bg-background-dark px-3 py-2 text-sm text-white focus:border-primary focus:outline-none sm:max-w-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={LIST_HEADER}>
            <span className="flex-1">Customer</span>
            <span className="hidden flex-1 sm:block">Contact</span>
            <span className="hidden w-48 shrink-0 md:block">Email</span>
            <span className="w-28 shrink-0 text-right">Terms</span>
          </div>
          <div className={LIST_CONTAINER}>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`${CUSTOMERS_BASE}/${c.id}`)}
                className={LIST_ROW}
              >
                <span className="flex-1 truncate text-white">
                  {c.displayName || c.companyName || c.contactName || 'Customer'}
                  {!c.isActive && (
                    <span className="ml-2 rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                      Inactive
                    </span>
                  )}
                </span>
                <span className="hidden flex-1 truncate text-sm text-slate-400 sm:block">
                  {c.contactName || '—'}
                </span>
                <span className="hidden w-48 shrink-0 truncate text-sm text-slate-400 md:block">
                  {c.email || '—'}
                </span>
                <span className="w-28 shrink-0 truncate text-right text-sm text-slate-400">
                  {c.terms || '—'}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                No customers match “{search}”.
              </p>
            )}
          </div>
        </>
      )}
    </AccountingShell>
  );
}
