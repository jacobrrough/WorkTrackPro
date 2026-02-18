import React, { useState, useEffect } from 'react';
import { ViewState } from '@/core/types';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/Toast';

interface AdminSettingsProps {
  onNavigate: (view: ViewState) => void;
  onBack: () => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onNavigate, onBack }) => {
  const { settings, updateSettings } = useSettings();
  const { showToast } = useToast();
  const [laborRate, setLaborRate] = useState(String(settings.laborRate));
  const [materialUpcharge, setMaterialUpcharge] = useState(String(settings.materialUpcharge));

  useEffect(() => {
    setLaborRate(String(settings.laborRate));
    setMaterialUpcharge(String(settings.materialUpcharge));
  }, [settings.laborRate, settings.materialUpcharge]);

  const handleSave = () => {
    const lr = parseFloat(laborRate);
    const mu = parseFloat(materialUpcharge);
    if (Number.isNaN(lr) || lr < 0) {
      showToast('Enter a valid labor rate (≥ 0)', 'error');
      return;
    }
    if (Number.isNaN(mu) || mu <= 0) {
      showToast('Enter a valid material upcharge (> 0)', 'error');
      return;
    }
    updateSettings({ laborRate: lr, materialUpcharge: mu });
    showToast('Settings saved', 'success');
  };

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex size-10 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Admin Settings</h1>
              <p className="text-xs text-slate-400">Labor rate & material upcharge</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-md space-y-6">
          <div className="rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">Pricing</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Labor rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  onBlur={handleSave}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="175"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Used to auto-calculate labor cost (hours × rate). Manual prices are not overwritten.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Material upcharge (multiplier)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={materialUpcharge}
                  onChange={(e) => setMaterialUpcharge(e.target.value)}
                  onBlur={handleSave}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="1.25"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Material cost we pay × upcharge = selling price (e.g. 1.25 = 25% markup).
                </p>
              </div>
            </div>
            <button
              onClick={handleSave}
              className="mt-4 w-full rounded-sm bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
