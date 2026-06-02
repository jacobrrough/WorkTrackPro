import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { AccountingShell } from './components/AccountingShell';
import { ACCOUNTING_NAV } from './constants';

export default function AccountingHome() {
  const navigate = useNavigate();
  const tiles = ACCOUNTING_NAV.filter((n) => n.key !== 'overview');

  return (
    <AccountingShell active="overview" title="Accounting">
      <div className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
        <span className="font-bold">Disclaimer:</span> Not certified tax software. Always verify
        figures with a CPA/EA. You are responsible for tax accuracy and timely filing.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.key} onClick={() => navigate(t.path)} className="flex flex-col items-start gap-2">
            <span className="material-symbols-outlined text-2xl text-primary">{t.icon}</span>
            <span className="font-bold text-white">{t.label}</span>
          </Card>
        ))}
      </div>
    </AccountingShell>
  );
}
