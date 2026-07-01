import { useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItem, ViewState } from '@/core/types';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import QRScanner from '@/components/QRScanner';
import { EmptyState } from '@/components/EmptyState';
import { ScrollablePage } from '@/components/ScrollablePage';
import { ToolStatusPill } from './ToolStatusPill';
import { ToolDetailSheet } from './ToolDetailSheet';
import { resolveToolByScan } from './toolScan';
import { holderName } from './toolFormat';

interface ToolsScreenProps {
  onNavigate: (view: ViewState) => void;
  /** When set (e.g. arriving from a scan or deep link), opens this tool's detail sheet on mount. */
  initialToolId?: string;
  /**
   * The tool fetched directly by the route (getByIds) for a deep link. Used as a fallback so the
   * detail sheet opens even when the global tools list hasn't loaded yet — or omits this tool.
   */
  initialTool?: InventoryItem | null;
  /** True when the deep-link fetch failed (network/RLS) so we can tell the user instead of silently doing nothing. */
  initialToolError?: boolean;
}

export default function ToolsScreen({
  onNavigate,
  initialToolId,
  initialTool,
  initialToolError,
}: ToolsScreenProps) {
  const { tools, users } = useApp();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(initialToolId ?? null);

  useEffect(() => {
    if (initialToolId) setSelectedToolId(initialToolId);
  }, [initialToolId]);

  // Prefer the live list entry; fall back to the directly-fetched tool so a deep link still
  // opens the sheet when the tool isn't in the loaded list. The fallback is gated on the
  // 'tool' category so a deep link to a non-tool inventory id can never open the custody sheet.
  const selectedTool = useMemo(
    () =>
      tools.find((t) => t.id === selectedToolId) ??
      (initialTool && initialTool.id === selectedToolId && initialTool.category === 'tool'
        ? initialTool
        : null),
    [tools, selectedToolId, initialTool]
  );

  // If a deep-linked tool fails to load (and can't be resolved from the list), tell the user
  // rather than silently showing the bare list with no sheet. Fires once per failed id.
  const erroredToastFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      initialToolId &&
      initialToolError &&
      !selectedTool &&
      erroredToastFor.current !== initialToolId
    ) {
      erroredToastFor.current = initialToolId;
      showToast("Couldn't load that tool — check your connection and try again.", 'error');
    }
  }, [initialToolId, initialToolError, selectedTool, showToast]);

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
      <header className="sticky top-0 z-10 border-b border-line bg-app/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex size-10 items-center justify-center rounded-lg border border-line bg-overlay/5 text-white transition-colors hover:bg-overlay/10"
            aria-label="Back to dashboard"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <div>
            <h1 className="app-section-title text-white">Tools</h1>
            <p className="text-xs text-muted">Scan to take or put away</p>
          </div>
        </div>
      </header>

      <ScrollablePage className="px-4 pt-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-lg bg-primary text-lg font-bold text-on-accent transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
            Scan a tool
          </button>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, barcode, bin, or who has it"
            className="min-h-[44px] w-full rounded-lg border border-line bg-overlay/5 px-3 text-white"
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
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-overlay/5 p-3 text-left transition-colors hover:bg-overlay/10"
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
      </ScrollablePage>

      {selectedTool && (
        <ToolDetailSheet item={selectedTool} onClose={() => setSelectedToolId(null)} />
      )}
    </div>
  );
}
