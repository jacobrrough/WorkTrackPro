import { useArAging } from '../hooks/useAccountingQueries';
import { AgingView } from './AgingView';

/** A/R aging — open customer invoices bucketed by days overdue (as of today). */
export default function ArAgingView() {
  const query = useArAging();
  return <AgingView kind="ar" query={query} />;
}
