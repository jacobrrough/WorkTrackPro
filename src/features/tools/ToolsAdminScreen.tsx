import { useState } from 'react';
import type { Tool, ViewState } from '@/core/types';
import { validateBinLocation } from '@/core/validation';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { toolsService } from '@/services/api/tools';
import BinLocationScanner from '@/BinLocationScanner';

interface ToolsAdminScreenProps {
  onNavigate: (view: ViewState) => void;
}

interface EditState {
  id: string;
  name: string;
  toolNumber: string;
  homeBin: string;
  description: string;
}

const inputClass =
  'w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none';

export default function ToolsAdminScreen({ onNavigate }: ToolsAdminScreenProps) {
  const { tools, refreshTools } = useApp();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [toolNumber, setToolNumber] = useState('');
  const [homeBin, setHomeBin] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which form's home-bin the scanner is currently targeting.
  const [binScannerFor, setBinScannerFor] = useState<'add' | 'edit' | null>(null);

  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));

  const validate = (n: string, num: string, bin: string): string | null => {
    if (!n.trim()) return 'Enter a tool name';
    if (!num.trim()) return 'Enter a tool number';
    if (!bin.trim()) return 'Enter a home bin';
    const binErr = validateBinLocation(bin.trim());
    if (binErr) return binErr;
    return null;
  };

  const handleAdd = async () => {
    const err = validate(name, toolNumber, homeBin);
    if (err) {
      showToast(err, 'error');
      return;
    }
    // Friendly duplicate check before hitting the unique index.
    if (tools.some((t) => t.toolNumber.trim().toLowerCase() === toolNumber.trim().toLowerCase())) {
      showToast(`Tool number “${toolNumber.trim()}” already exists`, 'error');
      return;
    }
    setSaving(true);
    const created = await toolsService.createTool({
      name: name.trim(),
      toolNumber: toolNumber.trim(),
      homeBin: homeBin.trim(),
      description: description.trim() || undefined,
    });
    setSaving(false);
    if (created) {
      showToast(`Added “${created.name}”`, 'success');
      setName('');
      setToolNumber('');
      setHomeBin('');
      setDescription('');
      await refreshTools();
    } else {
      showToast('Could not add tool (is the number unique?)', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const err = validate(editing.name, editing.toolNumber, editing.homeBin);
    if (err) {
      showToast(err, 'error');
      return;
    }
    if (
      tools.some(
        (t) =>
          t.id !== editing.id &&
          t.toolNumber.trim().toLowerCase() === editing.toolNumber.trim().toLowerCase()
      )
    ) {
      showToast(`Tool number “${editing.toolNumber.trim()}” already exists`, 'error');
      return;
    }
    setBusyId(editing.id);
    const updated = await toolsService.updateTool(editing.id, {
      name: editing.name.trim(),
      toolNumber: editing.toolNumber.trim(),
      homeBin: editing.homeBin.trim(),
      description: editing.description.trim() || undefined,
    });
    setBusyId(null);
    if (updated) {
      showToast('Saved', 'success');
      setEditing(null);
      await refreshTools();
    } else {
      showToast('Could not save changes', 'error');
    }
  };

  const handleRetire = async (tool: Tool) => {
    if (!window.confirm(`Retire “${tool.name}”? It will be taken out of service.`)) return;
    setBusyId(tool.id);
    const res = await toolsService.retire(tool.id);
    setBusyId(null);
    if (res.ok) {
      showToast(`Retired “${tool.name}”`, 'success');
      await refreshTools();
    } else {
      showToast(res.error || 'Could not retire tool', 'error');
    }
  };

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-app/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('tools')}
            className="flex size-10 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            aria-label="Back to tools"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Manage tools</h1>
            <p className="text-xs text-muted">Add tools, set home bins, retire</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Add tool */}
          <div className="rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Add a tool</h2>
            <div className="space-y-3">
              <input
                className={inputClass}
                placeholder="Name (e.g. Dewalt Impact Driver)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Tool number (unique — goes in the QR code)"
                value={toolNumber}
                onChange={(e) => setToolNumber(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Home bin (e.g. A4c)"
                  value={homeBin}
                  onChange={(e) => setHomeBin(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setBinScannerFor('add')}
                  className="shrink-0 rounded-sm border border-primary bg-primary/20 px-3 text-primary hover:bg-primary/30"
                  aria-label="Scan or enter home bin"
                  title="Scan / enter home bin"
                >
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                </button>
              </div>
              <textarea
                className={`${inputClass} resize-none`}
                rows={2}
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="min-h-[44px] w-full rounded-sm bg-primary font-bold text-on-accent hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add tool'}
              </button>
            </div>
          </div>

          {/* Catalog */}
          <div className="space-y-2">
            {sorted.length === 0 && (
              <p className="rounded-sm border border-dashed border-white/15 px-4 py-8 text-center text-sm text-muted">
                No tools yet. Add your first one above.
              </p>
            )}
            {sorted.map((tool) =>
              editing?.id === tool.id ? (
                <div key={tool.id} className="rounded-sm border border-primary/40 bg-white/5 p-4">
                  <div className="space-y-3">
                    <input
                      className={inputClass}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      placeholder="Name"
                    />
                    <input
                      className={inputClass}
                      value={editing.toolNumber}
                      onChange={(e) => setEditing({ ...editing, toolNumber: e.target.value })}
                      placeholder="Tool number"
                    />
                    <div className="flex gap-2">
                      <input
                        className={inputClass}
                        value={editing.homeBin}
                        onChange={(e) => setEditing({ ...editing, homeBin: e.target.value })}
                        placeholder="Home bin"
                      />
                      <button
                        type="button"
                        onClick={() => setBinScannerFor('edit')}
                        className="shrink-0 rounded-sm border border-primary bg-primary/20 px-3 text-primary hover:bg-primary/30"
                        aria-label="Scan or enter home bin"
                      >
                        <span className="material-symbols-outlined">qr_code_scanner</span>
                      </button>
                    </div>
                    <textarea
                      className={`${inputClass} resize-none`}
                      rows={2}
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={busyId === tool.id}
                        className="min-h-[44px] flex-1 rounded-sm bg-primary font-bold text-on-accent hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busyId === tool.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="min-h-[44px] flex-1 rounded-sm border border-white/10 bg-white/5 font-bold text-white hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/5 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">
                      {tool.name}
                      {tool.status === 'retired' && (
                        <span className="ml-2 text-xs font-semibold text-subtle">(retired)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      #{tool.toolNumber} • Home {tool.homeBin}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: tool.id,
                          name: tool.name,
                          toolNumber: tool.toolNumber,
                          homeBin: tool.homeBin,
                          description: tool.description ?? '',
                        })
                      }
                      className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      Edit
                    </button>
                    {tool.status !== 'retired' && (
                      <button
                        type="button"
                        onClick={() => handleRetire(tool)}
                        disabled={busyId === tool.id}
                        className="rounded-sm border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        Retire
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {binScannerFor && (
        <BinLocationScanner
          currentLocation={binScannerFor === 'edit' ? (editing?.homeBin ?? '') : homeBin}
          onLocationUpdate={(loc) => {
            if (binScannerFor === 'edit') {
              setEditing((prev) => (prev ? { ...prev, homeBin: loc } : prev));
            } else {
              setHomeBin(loc);
            }
            setBinScannerFor(null);
          }}
          onClose={() => setBinScannerFor(null)}
        />
      )}
    </div>
  );
}
