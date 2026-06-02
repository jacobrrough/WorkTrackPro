import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Account, DefaultAccounts } from '../types';

/**
 * Mock the accounting services barrel so we control the read (current lock) and the
 * write outcome (admin success vs. a non-admin insufficient_privilege rejection) without
 * a Supabase round-trip. The period-lock hooks call accountingSettingsService
 * .getClosedThroughDate()/.setClosedThroughDate(date); the COA-EXPAND "Default GL accounts"
 * panel additionally calls accountingSettingsService.getDefaultAccounts() and
 * accountsService.getAll(). Everything else on the barrel is irrelevant here.
 */
const getClosedThroughDate = vi.fn<() => Promise<string | null>>();
const setClosedThroughDate =
  vi.fn<(date: string | null) => Promise<{ ok: boolean; error?: string }>>();
const getDefaultAccounts = vi.fn<() => Promise<DefaultAccounts>>();
const getAllAccounts = vi.fn<() => Promise<Account[]>>();

vi.mock('@/services/api/accounting', () => ({
  accountingSettingsService: {
    getClosedThroughDate: () => getClosedThroughDate(),
    setClosedThroughDate: (date: string | null) => setClosedThroughDate(date),
    getDefaultAccounts: () => getDefaultAccounts(),
  },
  accountsService: {
    getAll: () => getAllAccounts(),
  },
}));

// Import the component AFTER the mock is registered.
import AccountingSettingsView from './AccountingSettingsView';

/** An all-null DefaultAccounts; override the keys a test cares about. */
function defaultAccounts(overrides: Partial<DefaultAccounts> = {}): DefaultAccounts {
  return {
    cash: null,
    undepositedFunds: null,
    accountsReceivable: null,
    inventoryAsset: null,
    accountsPayable: null,
    salesTaxPayable: null,
    salesIncome: null,
    serviceIncome: null,
    cogs: null,
    operatingExpenses: null,
    fixedAsset: null,
    accumulatedDepreciation: null,
    depreciationExpense: null,
    openingBalanceEquity: null,
    uncategorizedIncome: null,
    uncategorizedExpense: null,
    paymentProcessorClearing: null,
    ...overrides,
  };
}

/** A minimal Account stub for the resolver join. */
function account(id: string, accountNumber: string, name: string): Account {
  return {
    id,
    accountNumber,
    name,
    accountType: 'asset',
    accountSubtype: null,
    parentAccountId: null,
    normalBalance: 'debit',
    currency: 'USD',
    isActive: true,
    isSystem: true,
    description: null,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };
}

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/accounting/settings']}>
        <AccountingSettingsView />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The confirmation modal (role="dialog"); scope queries so we don't match page text. */
function dialog() {
  return screen.getByRole('dialog');
}

beforeEach(() => {
  getClosedThroughDate.mockReset();
  setClosedThroughDate.mockReset();
  // The "Default GL accounts" panel loads alongside the period lock. Give it benign
  // defaults so the period-lock tests don't have to care about it; the panel-specific
  // tests below override these.
  getDefaultAccounts.mockReset();
  getAllAccounts.mockReset();
  getDefaultAccounts.mockResolvedValue(defaultAccounts());
  getAllAccounts.mockResolvedValue([]);
});

describe('AccountingSettingsView — books-closed (period lock)', () => {
  it('shows the open state and the CPA/EA disclaimer (G9) when no lock is set', async () => {
    getClosedThroughDate.mockResolvedValue(null);
    renderScreen();

    expect(await screen.findByText(/Books open/i)).toBeInTheDocument();
    // G9 legal disclaimer is present on this financial-control surface.
    expect(screen.getByText(/Not certified tax software/i)).toBeInTheDocument();
    // Open books → no re-open control.
    expect(screen.queryByRole('button', { name: /Re-open the books/i })).not.toBeInTheDocument();
  });

  it('shows the locked state and the on-or-before rule when a lock is set', async () => {
    getClosedThroughDate.mockResolvedValue('2026-01-31');
    renderScreen();

    expect(await screen.findByText(/Books closed/i)).toBeInTheDocument();
    expect(screen.getByText(/on or before 2026-01-31/i)).toBeInTheDocument();
  });

  it('requires confirmation before calling the RPC (the dialog gates the change)', async () => {
    getClosedThroughDate.mockResolvedValue(null);
    setClosedThroughDate.mockResolvedValue({ ok: true });
    renderScreen();

    await screen.findByText(/Books open/i);

    // Pick a date and click the primary action — this should only OPEN the dialog.
    fireEvent.change(screen.getByLabelText(/Close the books through/i), {
      target: { value: '2026-02-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Close the books/i }));

    expect(dialog()).toBeInTheDocument();
    // Critically: nothing has been written yet.
    expect(setClosedThroughDate).not.toHaveBeenCalled();

    // Confirm inside the dialog → now the RPC is called with the chosen date.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Close books$/i }));
    await waitFor(() => expect(setClosedThroughDate).toHaveBeenCalledWith('2026-02-28'));
  });

  it('lets an admin MOVE the lock date: confirms, calls the RPC, and shows the new date', async () => {
    // First read returns the existing lock; after a successful write the query refetches
    // and returns the new date (simulating the invalidation in useSetClosedThroughDate).
    getClosedThroughDate
      .mockResolvedValueOnce('2026-01-31')
      .mockResolvedValue('2026-02-28');
    setClosedThroughDate.mockResolvedValue({ ok: true });
    renderScreen();

    expect(await screen.findByText(/on or before 2026-01-31/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Close the books through/i), {
      target: { value: '2026-02-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update lock date/i }));

    // Confirm the move.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Close books$/i }));

    await waitFor(() => expect(setClosedThroughDate).toHaveBeenCalledWith('2026-02-28'));
    // Dialog closes and the status reflects the moved lock after the refetch.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/on or before 2026-02-28/i)).toBeInTheDocument();
  });

  it('re-opens the books (clears the lock) via the dedicated action', async () => {
    getClosedThroughDate.mockResolvedValueOnce('2026-01-31').mockResolvedValue(null);
    setClosedThroughDate.mockResolvedValue({ ok: true });
    renderScreen();

    await screen.findByText(/Books closed/i);
    fireEvent.click(screen.getByRole('button', { name: /Re-open the books/i }));

    // The dialog confirms a re-open and the RPC is called with null.
    expect(within(dialog()).getByRole('heading', { name: /Re-open the books\?/i })).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Re-open books$/i }));

    await waitFor(() => expect(setClosedThroughDate).toHaveBeenCalledWith(null));
    expect(await screen.findByText(/Books open/i)).toBeInTheDocument();
  });

  it('surfaces a non-admin rejection inline and leaves the lock unchanged', async () => {
    getClosedThroughDate.mockResolvedValue(null);
    setClosedThroughDate.mockResolvedValue({
      ok: false,
      error: 'only accounting_admin may change the books-closed date',
    });
    renderScreen();

    await screen.findByText(/Books open/i);

    fireEvent.change(screen.getByLabelText(/Close the books through/i), {
      target: { value: '2026-02-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Close the books/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Close books$/i }));

    // The DB privilege error is shown verbatim, inside the still-open dialog.
    expect(
      await within(dialog()).findByText(/only accounting_admin may change the books-closed date/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The displayed lock state never changed — books are still open.
    expect(screen.getByText(/Books open/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry when the lock fails to load', async () => {
    getClosedThroughDate.mockRejectedValue(new Error('schema not exposed'));
    renderScreen();

    expect(await screen.findByText(/Could not load the books-closed date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});

describe('AccountingSettingsView — Default GL accounts (COA-EXPAND)', () => {
  it('resolves the COA-EXPAND structural mappings to their chart accounts', async () => {
    getClosedThroughDate.mockResolvedValue(null);
    // Seed ALL surfaced mappings (the 4 structural + the 6 core) to their documented account
    // numbers, so the whole panel resolves and we can assert "no Not configured / no mismatch".
    getDefaultAccounts.mockResolvedValue(
      defaultAccounts({
        openingBalanceEquity: 'id-3050',
        uncategorizedIncome: 'id-4900',
        uncategorizedExpense: 'id-6900',
        paymentProcessorClearing: 'id-1260',
        accountsReceivable: 'id-1200',
        accountsPayable: 'id-2000',
        salesIncome: 'id-4000',
        salesTaxPayable: 'id-2200',
        cash: 'id-1000',
        cogs: 'id-5000',
      })
    );
    getAllAccounts.mockResolvedValue([
      account('id-3050', '3050', 'Opening Balance Equity'),
      account('id-4900', '4900', 'Uncategorized Income'),
      account('id-6900', '6900', 'Uncategorized Expense'),
      account('id-1260', '1260', 'Payment Processor Clearing'),
      account('id-1200', '1200', 'Accounts Receivable'),
      account('id-2000', '2000', 'Accounts Payable'),
      account('id-4000', '4000', 'Sales'),
      account('id-2200', '2200', 'Sales Tax Payable'),
      account('id-1000', '1000', 'Cash'),
      account('id-5000', '5000', 'Cost of Goods Sold'),
    ]);
    renderScreen();

    // Wait for the panel's OWN data to resolve. The header renders even while loading, so
    // gate on the post-resolution caption (it only appears once both queries settle).
    expect(await screen.findByText('4 of 4 configured')).toBeInTheDocument();
    expect(screen.getByText('Structural accounts')).toBeInTheDocument();
    expect(screen.getByText('Core mappings')).toBeInTheDocument();
    // The role label appears (the seeded account here happens to share the role's name, so
    // it can occur in both the label and the resolved-account line — assert it's present).
    expect(screen.getAllByText('Opening Balance Equity').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Payment Processor Clearing/).length).toBeGreaterThan(0);
    // The resolved account NUMBERS are unique to the resolved-account line — assert each of
    // the four structural accounts (3050/4900/6900/1260) rendered its number.
    for (const num of ['3050', '4900', '6900', '1260']) {
      expect(screen.getByText(num)).toBeInTheDocument();
    }
    // Every surfaced mapping resolved → no "Not configured" flag anywhere, and since each
    // resolved to its documented number, no "expected NNNN" mismatch hint either.
    expect(screen.queryByText(/Not configured/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^expected /i)).not.toBeInTheDocument();
  });

  it('flags an unset structural mapping as "Not configured"', async () => {
    getClosedThroughDate.mockResolvedValue(null);
    // Only one structural key is seeded; the other three are null.
    getDefaultAccounts.mockResolvedValue(
      defaultAccounts({ openingBalanceEquity: 'id-3050' })
    );
    getAllAccounts.mockResolvedValue([account('id-3050', '3050', 'Opening Balance Equity')]);
    renderScreen();

    // Gate on the post-resolution caption so the panel's queries have settled, then assert
    // the unset rows. The structural group is partially configured (1 of 4).
    expect(await screen.findByText('1 of 4 configured')).toBeInTheDocument();
    // The three unset structural keys (plus the unset core keys) surface "Not configured".
    expect(screen.getAllByText(/Not configured/i).length).toBeGreaterThan(0);
  });

  it('surfaces a panel error (with its own retry) when the mappings fail to load', async () => {
    // The period lock loads fine; only the default-accounts read fails — the panel shows its
    // own error independently of the period-lock section.
    getClosedThroughDate.mockResolvedValue(null);
    getDefaultAccounts.mockRejectedValue(new Error('schema not exposed'));
    renderScreen();

    expect(
      await screen.findByText(/Could not load the default-account mappings/i)
    ).toBeInTheDocument();
    // The period-lock section still rendered (its own load succeeded).
    expect(screen.getByText(/Books open/i)).toBeInTheDocument();
  });
});
