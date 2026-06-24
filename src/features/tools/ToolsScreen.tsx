import { useEffect, useMemo, useState } from 'react';
import type { ViewState } from '@/core/types';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import QRScanner from '@/components/QRScanner';
import { EmptyState } from '@/components/EmptyState';
import { ToolStatusPill } from './ToolStatusPill';
import { ToolDetailSheet } from './ToolDetailSheet';
import { resolveToolByScan } from './toolScan';
import { holderName } from './toolFormat';

interface ToolsScreenProps {
  onNavigate: (view: ViewState) => void;
  /** When set (e.g. arriving from a scan), opens this tool's detail sheet on mount. */
  initialToolId?: string;
}

export default function ToolsScreen({ onNavigate, initialToolId }: ToolsScreenProps) {
  const { tools, users } = useApp();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(initialToolId ?? null);

  useEffect(() => {
    if (initialToolId) setSelectedToolId(initialToolId);
  }, [initialToolId]);

  const selectedTool = useMemo(
    () => tools.find((t) => t.id === selectedToolId) ?? null,
    [tools, selectedToolId]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q
      ? tools
      : tools.filter((t) => {
          const holder = t.currentHolderId
            ? holderName(users, t.currentHolderId).toLowerCase()
            : '';
          return (
            t.name.toLowerCase().includes(q) ||
            (t.barcode ?? '').toLowerCase().includes(q) ||
            (t.binLocation ?? '').toLowerCase().includes(q) ||
            holder.includes(q)
          );
        });
    // Checked-out tools first (likely what people look for), then by name.
    return [...filtered].sort((a, b) => {
      const aOut = a.currentHolderId ? 0 : 1;
      const bOut = b.currentHolderId ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      return a.name.localeCompare(b.name);
    });
  }, [tools, users, search]);

  const handleScan = (payload: string) => {
    setScanning(false);
    const tool = resolveToolByScan(payload, tools);
    if (!tool) {
      showToast(`No tool matches “${payload}”`, 'error');
      return;
    }
    setSelectedToolId(tool.id);
  };

  if (scanning) {
    return (
      <QRScanner
        scanType="any"
        title="Scan a tool"
        description="Scan the barcode on the tool"
        onScanComplete={handleScan}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-app/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex size-10 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            aria-label="Back to dashboard"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Tools</h1>
            <p className="text-xs text-muted">Scan to take or put away</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-sm bg-primary text-lg font-bold text-on-accent transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
            Scan a tool
          </button>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, barcode, bin, or who has it"
            className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
          />

          {visible.length === 0 ? (
            <EmptyState
              icon="handyman"
              title="No tools"
              hint={
                tools.length === 0
                  ? 'Add a tool in Inventory: Add Part → category “Tools”, with a barcode and bin.'
                  : 'No tools match your search.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {visible.map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedToolId(tool.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold text-white">{tool.name}</p>
                      <p className="truncate text-xs text-muted">
                        {tool.barcode ? `${tool.barcode} • ` : ''}
                        {tool.binLocation ? `Home ${tool.binLocation}` : 'No bin set'}
                      </p>
                    </div>
                    <ToolStatusPill
                      item={tool}
                      holderLabel={holderName(users, tool.currentHolderId)}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selectedTool && (
        <ToolDetailSheet item={selectedTool} onClose={() => setSelectedToolId(null)} />
      )}
    </div>
  );
}
