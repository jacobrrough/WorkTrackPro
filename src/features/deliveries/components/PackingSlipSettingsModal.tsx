import React, { useRef, useState } from 'react';
import { useSettings, type BrandingSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/Toast';
import { resizeImageFile, dataUrlBytes } from '@/lib/imageResize';

interface PackingSlipSettingsModalProps {
  onClose: () => void;
}

const MAX_LOGO_BYTES = 1_500_000; // ~1.5 MB after resize; keeps the settings row small

/**
 * Edit the company branding that appears on every packing slip: name, contact
 * details, and an uploaded logo (replacing the default "WorkTrack Pro" text).
 * Saves org-wide via SettingsContext so every employee's slips match.
 */
const PackingSlipSettingsModal: React.FC<PackingSlipSettingsModalProps> = ({ onClose }) => {
  const { settings, updateSettings, isSyncing } = useSettings();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<BrandingSettings>({ ...settings.branding });
  const [processingLogo, setProcessingLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<BrandingSettings>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file (PNG, JPG, SVG…)', 'error');
      return;
    }
    setProcessingLogo(true);
    try {
      const { dataUrl, bytes } = await resizeImageFile(file, 512);
      if (bytes > MAX_LOGO_BYTES) {
        showToast('That logo is too large even after resizing. Try a simpler image.', 'error');
        return;
      }
      set({ logoDataUrl: dataUrl });
    } catch {
      showToast('Could not read that image. Try a different file.', 'error');
    } finally {
      setProcessingLogo(false);
    }
  };

  const handleSave = async () => {
    const branding: BrandingSettings = {
      companyName: form.companyName.trim(),
      companyAddress: form.companyAddress.trim(),
      companyPhone: form.companyPhone.trim(),
      companyEmail: form.companyEmail.trim(),
      logoDataUrl: form.logoDataUrl,
    };
    setSaving(true);
    const result = await updateSettings({ branding });
    setSaving(false);
    if (result.success) {
      showToast('Packing slip branding saved', 'success');
      onClose();
    } else {
      showToast(
        result.error
          ? `Couldn't save branding: ${result.error}`
          : "Couldn't save branding. Admin access is required.",
        'error'
      );
    }
  };

  const busy = saving || isSyncing || processingLogo;
  const hasLogo = Boolean(form.logoDataUrl);
  const logoKb = hasLogo ? Math.round(dataUrlBytes(form.logoDataUrl) / 1024) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div
        className="flex w-full max-w-lg flex-col rounded-lg border border-line bg-surface-dark"
        style={{ maxHeight: '90vh' }}
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Packing Slip Branding</h2>
            <p className="text-xs text-muted">Shown on every packing slip you print or export.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Logo */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Logo</label>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-32 items-center justify-center overflow-hidden rounded border border-line bg-white">
                {hasLogo ? (
                  <img
                    src={form.logoDataUrl}
                    alt="Logo preview"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-[10px] text-muted">No logo yet</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">upload</span>
                  {processingLogo ? 'Processing…' : hasLogo ? 'Replace logo' : 'Upload logo'}
                </button>
                {hasLogo && (
                  <button
                    type="button"
                    onClick={() => set({ logoDataUrl: '' })}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm text-muted hover:bg-overlay/10 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">delete</span>
                    Remove
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-subtle">
              PNG with a transparent background works best. Large images are resized automatically.
              {hasLogo ? ` (${logoKb} KB)` : ''}
            </p>
          </div>

          {/* Company name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Company name</label>
            <input
              type="text"
              value={form.companyName}
              onChange={(e) => set({ companyName: e.target.value })}
              placeholder="Your Company, Inc."
              className="w-full rounded border border-line bg-overlay/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            />
          </div>

          {/* Address */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Address</label>
            <input
              type="text"
              value={form.companyAddress}
              onChange={(e) => set({ companyAddress: e.target.value })}
              placeholder="123 Shop St, City, ST 00000"
              className="w-full rounded border border-line bg-overlay/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Phone</label>
              <input
                type="tel"
                value={form.companyPhone}
                onChange={(e) => set({ companyPhone: e.target.value })}
                placeholder="(555) 123-4567"
                className="w-full rounded border border-line bg-overlay/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Email</label>
              <input
                type="email"
                value={form.companyEmail}
                onChange={(e) => set({ companyEmail: e.target.value })}
                placeholder="sales@company.com"
                className="w-full rounded border border-line bg-overlay/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <p className="text-[10px] text-subtle">
            Leave the company name blank to show only your logo.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded px-4 py-2 text-sm text-muted hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50"
          >
            {saving || isSyncing ? 'Saving…' : 'Save branding'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default PackingSlipSettingsModal;
