import { useRef, useState } from 'react';
import type { InventoryItem } from '@/core/types';
import { useToast } from '@/Toast';
import { ScrollablePage } from '@/components/ScrollablePage';
import { BarcodeScannerModal } from './detail/BarcodeScannerModal';
import { computeStockTarget, resolveScannedItem } from './stockAdjust';
import { getSku, matchesFilters } from './inventoryViewModel';

/**
 * Scan-first quick flow behind the hub's Stock In / Stock Out tiles: collect a quantity
 * and write an absolute stock recount via onUpdateStock. Always offers a manual search
 * fallback (not every part has a barcode / the camera may be blocked).
 */
export type StockAdjustFlowMode = 'in' | 'out';

interface StockAdjustFlowProps {
  mode: StockAdjustFlowMode;
  inventory: InventoryItem[];
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onClose: () => void;
  calculateAvailable: (item: InventoryItem) => number;
}

type Step = 'scan' | 'search' | 'qty';

const MODE_LABEL: Record<StockAdjustFlowMode, string> = {
  in: 'Stock In',
  out: 'Stock Out',
};

export default function StockAdjustFlow({
  mode,
  inventory,
  onUpdateStock,
  onClose,
  calculateAvailable,
}: StockAdjustFlowProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('scan');
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [qtyText, setQtyText] = useState('1');
  const [saving, setSaving] = useState(false);
  // BarcodeScannerModal calls onClose right after a successful scan; this flag lets us tell that
  // auto-close apart from the user tapping the X (which should cancel the whole flow).
  const justScannedRef = useRef(false);

  const adjustMode = mode; // 'in' | 'out'

  const chooseItem = (item: InventoryItem) => {
    setSelected(item);
    setQtyText('1');
    setStep('qty');
  };

  const handleScanned = (code: string) => {
    justScannedRef.current = true;
    const item = resolveScannedItem(inventory, code);
    if (!item) {
      showToast('No part matches that code — search instead', 'warning');
      setSearchTerm(code.trim());
      setStep('search');
      return;
    }
    chooseItem(item);
  };

  const handleScannerClose = () => {
    if (justScannedRef.current) {
      justScannedRef.current = false;
      return; // scanner auto-closed after a scan; the flow has already advanced
    }
    onClose();
  };

  const qty = parseFloat(qtyText);
  const validQty = Number.isFinite(qty) && qty > 0;
  const preview = selected
    ? computeStockTarget(adjustMode, selected.inStock, validQty ? qty : 0, selected.unit)
    : null;
  const available = selected ? calculateAvailable(selected) : 0;
  const overAvailable = mode === 'out' && validQty && qty > available;

  const handleConfirm = async () => {
    if (!selected || !preview || !validQty || saving) return;
    if (preview.target === selected.inStock) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onUpdateStock(selected.id, preview.target, preview.reason);
      showToast(mode === 'in' ? 'Stock added' : 'Stock removed', 'success');
      onClose();
    } catch {
      showToast('Failed to update stock — try again', 'error');
      setSaving(false); // keep the sheet open so the user can retry
    }
  };

  const searchResults = searchTerm.trim()
    ? inventory
        .filter((item) =>
          matchesFilters(item, { search: searchTerm, category: 'all', supplier: 'all' })
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 25)
    : [];

  return (
    <>
      <BarcodeScannerModal
        open={step === 'scan'}
        onClose={handleScannerClose}
        onScanned={handleScanned}
        showToast={showToast}
      />

      {step === 'scan' && (
        <div className="safe-area-pb fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4">
          <button
            type="button"
            onClick={() => setStep('search')}
            className="flex min-h-[48px] items-center gap-2 rounded-lg border border-line-strong bg-card-dark px-5 font-bold text-white shadow-lg"
          >
            <span className="material-symbols-outlined">search</span>
            Enter manually / Search
          </button>
        </div>
      )}

      {step === 'search' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background-dark">
          <header className="safe-area-top sticky top-0 z-10 border-b border-line bg-background-dark px-3 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex size-10 items-center justify-center rounded-lg border border-line text-white hover:bg-overlay/10"
                aria-label="Cancel"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              <div className="flex-1">
                <h1 className="app-section-title text-white">{MODE_LABEL[mode]}</h1>
                <p className="text-xs text-muted">Search by name or SKU</p>
              </div>
              <button
                type="button"
                onClick={() => setStep('scan')}
                className="flex size-10 items-center justify-center rounded-lg border border-line text-white hover:bg-overlay/10"
                aria-label="Back to scanner"
              >
                <span className="material-symbols-outlined">qr_code_scanner</span>
              </button>
            </div>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Part name, SKU, bin, category…"
              autoFocus
              className="mt-3 min-h-[44px] w-full rounded-lg border border-line bg-overlay/5 px-3 text-white focus:border-primary focus:outline-none"
            />
          </header>
          <ScrollablePage className="p-3">
            {!searchTerm.trim() ? (
              <p className="py-12 text-center text-sm text-subtle">Start typing to find a part.</p>
            ) : searchResults.length === 0 ? (
              <p className="py-12 text-center text-sm text-subtle">
                No parts match “{searchTerm.trim()}”.
              </p>
            ) : (
              <ul className="space-y-2">
                {searchResults.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => chooseItem(item)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card-dark p-3 text-left hover:border-primary/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-white">{item.name}</p>
                        <p className="truncate text-xs text-muted">SKU: {getSku(item)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold text-white">{item.inStock}</p>
                        <p className="text-[10px] uppercase tracking-wider text-subtle">
                          {item.unit}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollablePage>
        </div>
      )}

      {step === 'qty' && selected && preview && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3"
          role="dialog"
          aria-modal="true"
          aria-label={`${MODE_LABEL[mode]} quantity`}
          onClick={onClose}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-primary/30 bg-surface-2 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    mode === 'in' ? 'text-green-400' : 'text-amber-400'
                  }`}
                >
                  {MODE_LABEL[mode]}
                </p>
                <p className="truncate text-base font-bold text-white">{selected.name}</p>
                <p className="text-xs text-muted">
                  In stock: {selected.inStock} {selected.unit} · Available: {available}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
                aria-label="Cancel"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <label
              htmlFor="stock-adjust-qty"
              className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted"
            >
              Quantity to {mode === 'in' ? 'add' : 'remove'}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = (Number.isFinite(qty) ? qty : 0) - 1;
                  setQtyText(String(Math.max(0, next)));
                }}
                className="flex size-12 items-center justify-center rounded-lg border border-line text-white"
                aria-label="Decrease quantity"
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <input
                id="stock-adjust-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                className="min-h-[48px] flex-1 rounded-lg border border-line bg-overlay/5 px-3 text-center text-lg font-bold text-white focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const next = (Number.isFinite(qty) ? qty : 0) + 1;
                  setQtyText(String(next));
                }}
                className="flex size-12 items-center justify-center rounded-lg border border-line text-white"
                aria-label="Increase quantity"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-line bg-black/20 p-3 text-sm text-muted">
              New count:{' '}
              <span className="font-bold text-white">
                {selected.inStock} → {preview.target} {selected.unit}
              </span>
            </div>
            {overAvailable && (
              <p className="mt-2 text-xs text-amber-400">
                Heads up: removing more than the {available} available will eat into allocated
                stock.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[48px] flex-1 rounded-lg border border-line-strong px-4 font-bold text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!validQty || saving}
                className={`min-h-[48px] flex-1 rounded-lg px-4 font-bold text-white disabled:opacity-50 ${
                  mode === 'in' ? 'bg-green-600' : 'bg-amber-600'
                }`}
              >
                {saving ? 'Saving…' : mode === 'in' ? 'Add stock' : 'Remove stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
