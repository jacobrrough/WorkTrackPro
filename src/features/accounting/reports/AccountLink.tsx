import { Link } from 'react-router-dom';
import { accountLedgerPath } from '../constants';
import type { DateRange } from '../types';
import { NET_INCOME_LINE_ID } from './reportMath';

interface AccountLinkProps {
  accountId: string;
  accountNumber: string | null;
  name: string;
  /** Current report range, carried into the register so it opens on the same window. */
  range?: DateRange;
  /** Force non-clickable plain text (e.g. a synthetic/aggregate line). */
  disabled?: boolean;
}

/**
 * #3 drill-down — renders an account's "number · name" label. On a real account it is a
 * link into that account's general-ledger register (carrying the current date range as a
 * query string so the register opens on the same window). The Balance Sheet's synthetic
 * "Net income" line (NET_INCOME_LINE_ID) and any explicitly `disabled` line render as
 * plain text, since they are presentation figures with no underlying account to open.
 */
export function AccountLink({ accountId, accountNumber, name, range, disabled }: AccountLinkProps) {
  const numberSpan = accountNumber ? (
    <span className="mr-2 font-mono text-xs text-slate-500">{accountNumber}</span>
  ) : null;

  if (disabled || accountId === NET_INCOME_LINE_ID || !accountId) {
    return (
      <span className="text-white">
        {numberSpan}
        {name}
      </span>
    );
  }

  return (
    <Link
      to={accountLedgerPath(accountId, range)}
      className="text-white underline-offset-2 hover:text-primary hover:underline"
    >
      {numberSpan}
      {name}
    </Link>
  );
}
