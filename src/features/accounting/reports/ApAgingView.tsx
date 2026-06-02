import { useApAging } from '../hooks/useAccountingQueries';
import { AgingView } from './AgingView';

/** A/P aging — open vendor bills bucketed by days overdue (as of today). */
export default function ApAgingView() {
  const query = useApAging();
  return <AgingView kind="ap" query={query} />;
}
