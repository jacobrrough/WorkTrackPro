import React, { useState, useEffect, useMemo } from 'react';
import { ViewState, makeCategoryKey, isBuiltInInventoryCategory } from '@/core/types';
import { useApp } from '@/AppContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useInventoryCategories } from '@/features/inventory/useInventoryCategories';
import { useToast } from '@/Toast';
import {
  WorkWeekSchedule,
  getDayScheduleHours,
  getWeeklyCapacityHours,
  getWeeklyWorkHours,
  normalizeWorkWeekSchedule,
} from '@/lib/workHours';
import { getCurrentPosition } from '@/lib/geoUtils';
import { userService } from '@/services/api/users';
import { supabase } from '@/services/api/supabaseClient';

interface AdminSettingsProps {
  onNavigate: (view: ViewState) => void;
  onBack: () => void;
}

const WEEK_DAYS: Array<{ day: number; short: string; label: string }> = [
  { day: 1, short: 'Mon', label: 'Monday' },
  { day: 2, short: 'Tue', label: 'Tuesday' },
  { day: 3, short: 'Wed', label: 'Wednesday' },
  { day: 4, short: 'Thu', label: 'Thursday' },
  { day: 5, short: 'Fri', label: 'Friday' },
  { day: 6, short: 'Sat', label: 'Saturday' },
  { day: 0, short: 'Sun', label: 'Sunday' },
];

const AdminSettings: React.FC<AdminSettingsProps> = ({ onNavigate: _onNavigate, onBack }) => {
  const {
    currentUser,
    users,
    refreshUsers,
    jobs,
    inventory,
    updateJob,
    updateInventoryItem,
    refreshJobs,
    refreshInventory,
  } = useApp();
  const { settings, updateSettings, isSyncing } = useSettings();
  const { options: categoryOptions } = useInventoryCategories();
  const { showToast } = useToast();
  const isAdmin = currentUser?.isAdmin === true;
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [laborRate, setLaborRate] = useState(String(settings.laborRate));
  const [materialUpcharge, setMaterialUpcharge] = useState(String(settings.materialUpcharge));
  const [cncRate, setCncRate] = useState(String(settings.cncRate));
  const [printer3DRate, setPrinter3DRate] = useState(String(settings.printer3DRate));
  const [employeeCount, setEmployeeCount] = useState(String(settings.employeeCount));
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(String(settings.overtimeMultiplier));
  const [workWeekSchedule, setWorkWeekSchedule] = useState<WorkWeekSchedule>(() =>
    normalizeWorkWeekSchedule(settings.workWeekSchedule)
  );
  const [requireOnSite, setRequireOnSite] = useState(settings.requireOnSite);
  const [siteLat, setSiteLat] = useState(settings.siteLat != null ? String(settings.siteLat) : '');
  const [siteLng, setSiteLng] = useState(settings.siteLng != null ? String(settings.siteLng) : '');
  const [siteRadiusMeters, setSiteRadiusMeters] = useState(
    settings.siteRadiusMeters != null ? String(settings.siteRadiusMeters) : '200'
  );
  const [enforceOnSiteAtLogin, setEnforceOnSiteAtLogin] = useState(settings.enforceOnSiteAtLogin);
  const [requireMfa, setRequireMfa] = useState(settings.requireMfa);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [resettingMfaUserId, setResettingMfaUserId] = useState<string | null>(null);
  const [clearingBin, setClearingBin] = useState<string | null>(null);
  // Which rack accordions are expanded in Shelf / Bin Reconcile. Empty = all
  // collapsed, which is the default.
  const [openRacks, setOpenRacks] = useState<Set<string>>(new Set());
  const toggleRack = (rack: string) =>
    setOpenRacks((prev) => {
      const next = new Set(prev);
      if (next.has(rack)) next.delete(rack);
      else next.add(rack);
      return next;
    });

  useEffect(() => {
    if (!isAdmin) return;
    void refreshUsers();
  }, [isAdmin, refreshUsers]);

  useEffect(() => {
    setLaborRate(String(settings.laborRate));
    setMaterialUpcharge(String(settings.materialUpcharge));
    setCncRate(String(settings.cncRate));
    setPrinter3DRate(String(settings.printer3DRate));
    setEmployeeCount(String(settings.employeeCount));
    setOvertimeMultiplier(String(settings.overtimeMultiplier));
    setWorkWeekSchedule(normalizeWorkWeekSchedule(settings.workWeekSchedule));
  }, [
    settings.laborRate,
    settings.materialUpcharge,
    settings.cncRate,
    settings.printer3DRate,
    settings.employeeCount,
    settings.overtimeMultiplier,
    settings.workWeekSchedule,
    settings.requireOnSite,
    settings.siteLat,
    settings.siteLng,
    settings.siteRadiusMeters,
    settings.enforceOnSiteAtLogin,
  ]);

  useEffect(() => {
    setRequireOnSite(settings.requireOnSite);
    setSiteLat(settings.siteLat != null ? String(settings.siteLat) : '');
    setSiteLng(settings.siteLng != null ? String(settings.siteLng) : '');
    setSiteRadiusMeters(
      settings.siteRadiusMeters != null ? String(settings.siteRadiusMeters) : '200'
    );
    setEnforceOnSiteAtLogin(settings.enforceOnSiteAtLogin);
    setRequireMfa(settings.requireMfa);
  }, [
    settings.requireOnSite,
    settings.siteLat,
    settings.siteLng,
    settings.siteRadiusMeters,
    settings.enforceOnSiteAtLogin,
    settings.requireMfa,
  ]);

  const handleUseMyLocation = async () => {
    setIsGettingLocation(true);
    const result = await getCurrentPosition({ timeoutMs: 12_000 });
    setIsGettingLocation(false);
    if (result.ok) {
      setSiteLat(result.position.latitude.toFixed(6));
      setSiteLng(result.position.longitude.toFixed(6));
      showToast('Location set. Adjust radius if needed.', 'success');
    } else {
      const msg =
        result.error === 'permission_denied'
          ? 'Location permission denied. Allow location in browser to set site.'
          : result.error === 'timeout'
            ? 'Location timed out. Try again.'
            : 'Could not get location.';
      showToast(msg, 'error');
    }
  };

  const regularHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(workWeekSchedule),
    [workWeekSchedule]
  );
  const maxHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(workWeekSchedule, { includeOvertime: true }),
    [workWeekSchedule]
  );
  const overtimeHoursPerEmployee = useMemo(
    () => Math.max(0, maxHoursPerEmployee - regularHoursPerEmployee),
    [maxHoursPerEmployee, regularHoursPerEmployee]
  );
  const weeklyCapacity = useMemo(() => {
    const count = parseInt(employeeCount, 10);
    if (!Number.isFinite(count) || count < 1) return regularHoursPerEmployee;
    return getWeeklyCapacityHours(count, workWeekSchedule);
  }, [employeeCount, regularHoursPerEmployee, workWeekSchedule]);
  const weeklyCapacityWithOt = useMemo(() => {
    const count = parseInt(employeeCount, 10);
    if (!Number.isFinite(count) || count < 1) return maxHoursPerEmployee;
    return getWeeklyCapacityHours(count, workWeekSchedule, { includeOvertime: true });
  }, [employeeCount, maxHoursPerEmployee, workWeekSchedule]);

  const updateDaySchedule = (
    day: number,
    patch:
      | Partial<WorkWeekSchedule[number]>
      | ((prev: WorkWeekSchedule[number]) => WorkWeekSchedule[number])
  ) => {
    setWorkWeekSchedule((prev) => {
      const current = prev[day];
      const nextDay = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      return { ...prev, [day]: nextDay };
    });
  };

  const handleSave = async () => {
    if (!isAdmin) {
      showToast('Admin access required', 'error');
      return;
    }
    const lr = parseFloat(laborRate);
    const mu = parseFloat(materialUpcharge);
    const cr = parseFloat(cncRate);
    const p3r = parseFloat(printer3DRate);
    const ec = parseInt(employeeCount, 10);
    const otMultiplier = parseFloat(overtimeMultiplier);
    if (!Number.isFinite(ec) || ec < 1) {
      showToast('Enter a valid number of employees (≥ 1)', 'error');
      return;
    }

    if (!Number.isFinite(otMultiplier) || otMultiplier < 1) {
      showToast('Enter a valid overtime multiplier (≥ 1.0)', 'error');
      return;
    }

    const normalizedSchedule = normalizeWorkWeekSchedule(workWeekSchedule);
    for (const { day, short } of WEEK_DAYS) {
      const daySchedule = normalizedSchedule[day];
      if (!daySchedule.enabled) continue;

      const dayHours = getDayScheduleHours(daySchedule);
      if (dayHours.standardWindowHours <= 0) {
        showToast(`${short}: set a valid regular start/end window`, 'error');
        return;
      }
      if (daySchedule.unpaidBreakMinutes > dayHours.standardWindowHours * 60) {
        showToast(`${short}: unpaid break is longer than the regular shift`, 'error');
        return;
      }
      if (daySchedule.overtimeEnabled && dayHours.overtimeHoursPerEmployee <= 0) {
        showToast(`${short}: set a valid overtime start/end window`, 'error');
        return;
      }
    }

    if (Number.isNaN(lr) || lr < 0) {
      showToast('Enter a valid labor rate (≥ 0)', 'error');
      return;
    }
    if (Number.isNaN(mu) || mu <= 0) {
      showToast('Enter a valid material upcharge (> 0)', 'error');
      return;
    }
    if (Number.isNaN(cr) || cr < 0) {
      showToast('Enter a valid CNC rate (≥ 0)', 'error');
      return;
    }
    if (Number.isNaN(p3r) || p3r < 0) {
      showToast('Enter a valid 3D printer rate (≥ 0)', 'error');
      return;
    }
    const radiusNum = siteRadiusMeters.trim() ? parseFloat(siteRadiusMeters) : null;
    if (requireOnSite && (siteLat.trim() === '' || siteLng.trim() === '')) {
      showToast(
        'Set site location (or use "Use my location") when requiring on-site check',
        'error'
      );
      return;
    }
    if (requireOnSite && (radiusNum == null || !Number.isFinite(radiusNum) || radiusNum < 10)) {
      showToast('Set a valid on-site radius (at least 10 meters)', 'error');
      return;
    }

    const result = await updateSettings({
      laborRate: lr,
      materialUpcharge: mu,
      cncRate: cr,
      printer3DRate: p3r,
      employeeCount: ec,
      overtimeMultiplier: otMultiplier,
      workWeekSchedule: normalizedSchedule,
      requireOnSite: requireOnSite,
      siteLat: siteLat.trim() && Number.isFinite(parseFloat(siteLat)) ? parseFloat(siteLat) : null,
      siteLng: siteLng.trim() && Number.isFinite(parseFloat(siteLng)) ? parseFloat(siteLng) : null,
      siteRadiusMeters:
        radiusNum != null && Number.isFinite(radiusNum) && radiusNum >= 10 ? radiusNum : null,
      enforceOnSiteAtLogin: enforceOnSiteAtLogin,
      requireMfa: requireMfa,
    });
    if (result.success) {
      showToast('Settings saved for organization', 'success');
      return;
    }
    showToast(
      result.error
        ? `Failed to save org settings: ${result.error}`
        : 'Failed to save organization settings',
      'error'
    );
  };

  const pendingUsers = useMemo(() => (users ?? []).filter((u) => u.isApproved === false), [users]);
  const approvedUsers = useMemo(() => (users ?? []).filter((u) => u.isApproved !== false), [users]);

  /** Bins that have at least one job or inventory item, with counts. */
  const binsWithCounts = useMemo(() => {
    const map = new Map<string, { jobIds: string[]; inventoryIds: string[] }>();
    (jobs ?? []).forEach((j) => {
      const bin = j.binLocation?.trim();
      if (!bin) return;
      const entry = map.get(bin) ?? { jobIds: [], inventoryIds: [] };
      entry.jobIds.push(j.id);
      map.set(bin, entry);
    });
    (inventory ?? []).forEach((item) => {
      const bin = item.binLocation?.trim();
      if (!bin) return;
      const entry = map.get(bin) ?? { jobIds: [], inventoryIds: [] };
      entry.inventoryIds.push(item.id);
      map.set(bin, entry);
    });
    return Array.from(map.entries())
      .map(([bin, counts]) => ({ bin, ...counts }))
      .sort((a, b) => a.bin.localeCompare(b.bin));
  }, [jobs, inventory]);

  /**
   * Bins grouped by rack — the first letter of the bin code (e.g. "A4c" → "A").
   * Each group carries its bin/job/item totals for the collapsed accordion
   * header, and groups are sorted alphabetically by rack letter.
   */
  const binsByRack = useMemo(() => {
    const groups = new Map<string, typeof binsWithCounts>();
    for (const entry of binsWithCounts) {
      const rack = (entry.bin[0] ?? '?').toUpperCase();
      const list = groups.get(rack) ?? [];
      list.push(entry);
      groups.set(rack, list);
    }
    return Array.from(groups.entries())
      .map(([rack, bins]) => ({
        rack,
        bins,
        jobTotal: bins.reduce((sum, b) => sum + b.jobIds.length, 0),
        inventoryTotal: bins.reduce((sum, b) => sum + b.inventoryIds.length, 0),
      }))
      .sort((a, b) => a.rack.localeCompare(b.rack));
  }, [binsWithCounts]);

  const handleClearShelf = async (bin: string) => {
    if (!updateJob || !updateInventoryItem) return;
    setClearingBin(bin);
    try {
      const entry = binsWithCounts.find((b) => b.bin === bin);
      if (!entry) return;
      await Promise.all([
        ...entry.jobIds.map((id) => updateJob(id, { binLocation: undefined })),
        ...entry.inventoryIds.map((id) => updateInventoryItem(id, { binLocation: undefined })),
      ]);
      const total = entry.jobIds.length + entry.inventoryIds.length;
      showToast(`Cleared shelf ${bin} (${total} item(s))`, 'success');
      await refreshJobs?.();
      await refreshInventory?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to clear shelf';
      showToast(msg, 'error');
    } finally {
      setClearingBin(null);
    }
  };

  const handleAddCategory = async () => {
    if (!isAdmin) {
      showToast('Admin access required', 'error');
      return;
    }
    const label = newCategoryLabel.trim();
    const key = makeCategoryKey(label);
    if (!label || !key) {
      showToast('Enter a category name with letters or numbers', 'error');
      return;
    }
    // Reject a duplicate by derived key OR by case-insensitive label, against built-ins + custom.
    const labelLower = label.toLowerCase();
    if (categoryOptions.some((c) => c.key === key || c.label.toLowerCase() === labelLower)) {
      showToast(`"${label}" already exists`, 'error');
      return;
    }
    const next = [...settings.customInventoryCategories, { key, label }];
    const result = await updateSettings({ customInventoryCategories: next });
    if (result.success) {
      showToast(`Added category "${label}"`, 'success');
      setNewCategoryLabel('');
    } else {
      showToast(
        result.error ? `Failed to add category: ${result.error}` : 'Failed to add category',
        'error'
      );
    }
  };

  const handleRemoveCategory = async (key: string, label: string) => {
    if (!isAdmin) {
      showToast('Admin access required', 'error');
      return;
    }
    const inUse = (inventory ?? []).filter((i) => i.category === key).length;
    if (inUse > 0) {
      showToast(`${inUse} item(s) still use "${label}" — reassign them first`, 'error');
      return;
    }
    const next = settings.customInventoryCategories.filter((c) => c.key !== key);
    // Drop the key from cncAbleCategories too so a removed category can't dangle in that set.
    const nextCnc = (settings.cncAbleCategories ?? []).filter((c) => c !== key);
    const result = await updateSettings({
      customInventoryCategories: next,
      cncAbleCategories: nextCnc,
    });
    if (result.success) {
      showToast(`Removed category "${label}"`, 'success');
    } else {
      showToast(
        result.error ? `Failed to remove category: ${result.error}` : 'Failed to remove category',
        'error'
      );
    }
  };

  const handleApprove = async (userId: string, makeAdmin: boolean) => {
    if (!isAdmin || !currentUser?.id) {
      showToast('Admin access required', 'error');
      return;
    }
    setBusyUserId(userId);
    try {
      await userService.updateUser(userId, {
        isApproved: true,
        approvedAt: new Date().toISOString(),
        approvedBy: currentUser.id,
        isAdmin: makeAdmin ? true : undefined,
      });
      showToast(makeAdmin ? 'User approved as admin' : 'User approved', 'success');
      await refreshUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to approve user';
      showToast(msg, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleToggleAdmin = async (userId: string, nextIsAdmin: boolean) => {
    if (!isAdmin) {
      showToast('Admin access required', 'error');
      return;
    }
    if (currentUser?.id === userId) {
      showToast("Can't change your own admin role here", 'warning');
      return;
    }
    setBusyUserId(userId);
    try {
      await userService.updateUser(userId, { isAdmin: nextIsAdmin });
      showToast(nextIsAdmin ? 'User set as admin' : 'Admin removed', 'success');
      await refreshUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update user role';
      showToast(msg, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  // Admin recovery path for a user locked out of 2FA: remove all their enrolled MFA
  // factors via the service-role Netlify function so they can re-enroll on next login.
  const handleResetMfa = async (userId: string, label: string) => {
    if (!isAdmin) {
      showToast('Admin access required', 'error');
      return;
    }
    const confirmed = window.confirm(
      `Reset two-factor authentication for ${label}? They will be asked to set it up again on their next login.`
    );
    if (!confirmed) return;

    setResettingMfaUserId(userId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast('Not authenticated', 'error');
        return;
      }

      const response = await fetch('/api/reset-user-mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        showToast(result?.error || `Failed to reset 2FA (HTTP ${response.status})`, 'error');
        return;
      }

      const removed = typeof result.removed === 'number' ? result.removed : 0;
      showToast(
        removed > 0
          ? `2FA reset — removed ${removed} factor(s)`
          : 'No 2FA factors to remove for this user',
        'success'
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to reset 2FA';
      showToast(msg, 'error');
    } finally {
      setResettingMfaUserId(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="app-header px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="app-icon-btn border border-line bg-overlay/5 text-white"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div>
              <h1 className="app-section-title text-white">Admin Settings</h1>
              <p className="text-xs text-muted">Pricing, machine rates, and scheduling capacity</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-md space-y-6">
          {isAdmin && (
            <div className="app-list-row p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Users</h2>
                  <p className="text-[10px] text-subtle">Approve new users and set admin access.</p>
                </div>
                {pendingUsers.length > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-300">
                    {pendingUsers.length} pending
                  </span>
                )}
              </div>

              {pendingUsers.length === 0 && (
                <p className="text-sm text-muted">No users pending approval.</p>
              )}

              {pendingUsers.length > 0 && (
                <div className="space-y-3">
                  {pendingUsers.map((u) => (
                    <div
                      key={u.id}
                      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {u.name || u.email || 'User'}
                          </p>
                          <p className="truncate text-xs text-muted">{u.email}</p>
                        </div>
                        <span className="rounded-full bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-300">
                          Pending
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={busyUserId === u.id}
                          onClick={() => handleApprove(u.id, false)}
                          className="min-h-[44px] touch-manipulation rounded-lg bg-primary px-3 py-3 text-sm font-bold text-on-accent disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyUserId === u.id}
                          onClick={() => handleApprove(u.id, true)}
                          className="min-h-[44px] touch-manipulation rounded-lg border border-line bg-overlay/5 px-3 py-3 text-sm font-bold text-white hover:bg-overlay/10 disabled:opacity-60"
                        >
                          Approve + Admin
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {approvedUsers.length > 0 && (
                <div className="mt-5 space-y-2">
                  <h3 className="text-xs font-semibold text-muted">Approved</h3>
                  {approvedUsers.map((u) => (
                    <div
                      key={u.id}
                      className="app-list-row flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {u.name || u.email || 'User'}
                        </p>
                        <p className="truncate text-xs text-muted">{u.email}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={resettingMfaUserId === u.id}
                          onClick={() => handleResetMfa(u.id, u.name || u.email || 'this user')}
                          className="min-h-[44px] touch-manipulation rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-60"
                          title="Remove this user's 2FA factors so they can re-enroll (locked-out recovery)"
                        >
                          {resettingMfaUserId === u.id ? 'Resetting…' : 'Reset 2FA'}
                        </button>
                        <button
                          type="button"
                          disabled={busyUserId === u.id || currentUser?.id === u.id}
                          onClick={() => handleToggleAdmin(u.id, !u.isAdmin)}
                          className="min-h-[44px] touch-manipulation rounded-lg border border-line bg-overlay/5 px-3 py-2 text-xs font-semibold text-white hover:bg-overlay/10 disabled:opacity-60"
                        >
                          {u.isAdmin ? 'Remove admin' : 'Make admin'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="app-list-row p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">Pricing</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Labor rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  className="app-input"
                  placeholder="175"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Used to auto-calculate labor cost (hours × rate). Manual prices are not
                  overwritten.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Material upcharge (multiplier)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={materialUpcharge}
                  onChange={(e) => setMaterialUpcharge(e.target.value)}
                  className="app-input"
                  placeholder="1.25"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Material cost we pay × upcharge = selling price (e.g. 1.25 = 25% markup).
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  CNC rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={cncRate}
                  onChange={(e) => setCncRate(e.target.value)}
                  className="app-input"
                  placeholder="150"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Rate per hour for CNC machine time (used in part quotes).
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  3D Printer rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={printer3DRate}
                  onChange={(e) => setPrinter3DRate(e.target.value)}
                  className="app-input"
                  placeholder="100"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Rate per hour for 3D printer time (used in part quotes).
                </p>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="app-btn app-btn-primary mt-4 w-full py-2.5 text-sm"
            >
              {isSyncing ? 'Saving...' : 'Save'}
            </button>
          </div>

          {isAdmin && (
            <div className="app-list-row p-4">
              <h2 className="mb-1 text-sm font-semibold text-white">Inventory categories</h2>
              <p className="mb-3 text-[11px] text-subtle">
                Categories available when adding or editing inventory items. The 7 built-in
                categories are always available; add your own below. A custom category can be
                removed once no items use it.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                {categoryOptions.map((opt) => {
                  const builtIn = isBuiltInInventoryCategory(opt.key);
                  return (
                    <span
                      key={opt.key}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${
                        builtIn
                          ? 'border-line bg-overlay/5 text-muted'
                          : 'border-primary/50 bg-primary/20 text-primary'
                      }`}
                    >
                      {opt.label}
                      {builtIn ? (
                        <span className="text-[10px] font-normal text-subtle">built-in</span>
                      ) : (
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => handleRemoveCategory(opt.key, opt.label)}
                          className="ml-0.5 flex items-center text-primary/70 hover:text-primary disabled:opacity-50"
                          aria-label={`Remove ${opt.label}`}
                          title={`Remove ${opt.label}`}
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            close
                          </span>
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryLabel}
                  onChange={(e) => setNewCategoryLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddCategory();
                    }
                  }}
                  placeholder="New category name (e.g. Adhesives)"
                  className="min-h-[44px] flex-1 rounded-lg border border-line bg-overlay/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddCategory()}
                  disabled={isSyncing || !newCategoryLabel.trim()}
                  className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-on-accent transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          <div className="app-list-row p-4">
            <h2 className="mb-1 text-sm font-semibold text-white">CNC-able material categories</h2>
            <p className="mb-3 text-[11px] text-subtle">
              Materials in these categories are deducted when units are marked CNC-done. Everything
              else deducts when a unit is marked fully done.
            </p>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((opt) => {
                const selected = (settings.cncAbleCategories ?? ['foam']).includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={isSyncing}
                    onClick={() => {
                      const set = new Set(settings.cncAbleCategories ?? ['foam']);
                      if (set.has(opt.key)) set.delete(opt.key);
                      else set.add(opt.key);
                      void updateSettings({ cncAbleCategories: Array.from(set) });
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                      selected
                        ? 'border-primary/50 bg-primary/20 text-primary'
                        : 'border-line bg-overlay/5 text-muted hover:bg-overlay/10'
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                    {selected ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="app-list-row p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">Scheduling Capacity</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Employees on shop floor
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={employeeCount}
                  onChange={(e) => setEmployeeCount(e.target.value)}
                  className="app-input"
                  placeholder="5"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Used to calculate total schedulable hours each day/week.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Overtime multiplier
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.05"
                  value={overtimeMultiplier}
                  onChange={(e) => setOvertimeMultiplier(e.target.value)}
                  className="app-input"
                  placeholder="1.50"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Used to estimate additional labor cost for overtime hours (e.g., 1.5 = time and a
                  half).
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted">Work week schedule</p>
                <div className="space-y-3">
                  {WEEK_DAYS.map(({ day, short, label }) => {
                    const daySchedule = workWeekSchedule[day];
                    const dayHours = getDayScheduleHours(daySchedule);
                    return (
                      <div key={day} className="app-list-row p-3 text-xs text-muted">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-white">{label}</p>
                            <p className="text-[10px] text-subtle">
                              {dayHours.regularHoursPerEmployee.toFixed(1)}h regular
                              {daySchedule.overtimeEnabled &&
                                dayHours.overtimeHoursPerEmployee > 0 &&
                                ` + ${dayHours.overtimeHoursPerEmployee.toFixed(1)}h OT`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateDaySchedule(day, { enabled: !daySchedule.enabled })
                            }
                            className={`h-6 w-12 rounded-full transition-colors ${daySchedule.enabled ? 'bg-primary' : 'bg-overlay/20'}`}
                            aria-label={`${short} enabled`}
                          >
                            <span
                              className={`block h-5 w-5 rounded-full bg-white transition-transform ${daySchedule.enabled ? 'translate-x-6' : 'translate-x-0.5'}`}
                            />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="text-[10px] text-muted">
                            Start
                            <input
                              type="time"
                              value={daySchedule.standardStart}
                              onChange={(e) =>
                                updateDaySchedule(day, { standardStart: e.target.value })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[10px] text-muted">
                            End
                            <input
                              type="time"
                              value={daySchedule.standardEnd}
                              onChange={(e) =>
                                updateDaySchedule(day, { standardEnd: e.target.value })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[10px] text-muted">
                            Unpaid break (min)
                            <input
                              type="number"
                              min="0"
                              max="720"
                              step="5"
                              value={daySchedule.unpaidBreakMinutes}
                              onChange={(e) =>
                                updateDaySchedule(day, {
                                  unpaidBreakMinutes: Number(e.target.value || 0),
                                })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                        </div>

                        <div className="mt-2 rounded border border-line bg-black/20 p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted">
                              Overtime window
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateDaySchedule(day, {
                                  overtimeEnabled: !daySchedule.overtimeEnabled,
                                })
                              }
                              disabled={!daySchedule.enabled}
                              className={`h-5 w-10 rounded-full transition-colors ${daySchedule.overtimeEnabled ? 'bg-amber-500' : 'bg-overlay/20'} disabled:opacity-40`}
                              aria-label={`${short} overtime enabled`}
                            >
                              <span
                                className={`block h-4 w-4 rounded-full bg-white transition-transform ${daySchedule.overtimeEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                              />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="text-[10px] text-muted">
                              OT Start
                              <input
                                type="time"
                                value={daySchedule.overtimeStart}
                                onChange={(e) =>
                                  updateDaySchedule(day, { overtimeStart: e.target.value })
                                }
                                disabled={!daySchedule.enabled || !daySchedule.overtimeEnabled}
                                className="mt-1 w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                              />
                            </label>
                            <label className="text-[10px] text-muted">
                              OT End
                              <input
                                type="time"
                                value={daySchedule.overtimeEnd}
                                onChange={(e) =>
                                  updateDaySchedule(day, { overtimeEnd: e.target.value })
                                }
                                disabled={!daySchedule.enabled || !daySchedule.overtimeEnabled}
                                className="mt-1 w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-sm">
                <p className="text-muted">
                  Weekly regular hours per employee:{' '}
                  <span className="font-bold text-white">
                    {regularHoursPerEmployee.toFixed(1)}h
                  </span>
                </p>
                <p className="mt-1 text-muted">
                  Weekly possible overtime per employee:{' '}
                  <span className="font-bold text-amber-300">
                    {overtimeHoursPerEmployee.toFixed(1)}h
                  </span>
                </p>
                <p className="mt-1 text-muted">
                  Weekly regular shop capacity:{' '}
                  <span className="font-bold text-primary">{weeklyCapacity.toFixed(1)}h</span>
                </p>
                <p className="mt-1 text-muted">
                  Weekly max capacity with overtime:{' '}
                  <span className="font-bold text-amber-300">
                    {weeklyCapacityWithOt.toFixed(1)}h
                  </span>
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="app-btn app-btn-primary mt-4 w-full py-2.5 text-sm"
            >
              {isSyncing ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="app-list-row p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">On-site check</h2>
            <p className="mb-4 text-xs text-muted">
              Require employees to be within a radius of your site when clocking in (and optionally
              when logging in). Uses device location; HTTPS and location permission required.
            </p>
            <div className="space-y-4">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={requireOnSite}
                  onChange={(e) => setRequireOnSite(e.target.checked)}
                  className="size-5 rounded border-line-strong bg-overlay/5"
                />
                <span className="text-sm text-white">Require on-site to clock in</span>
              </label>
              {requireOnSite && (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-muted">Latitude</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={siteLat}
                        onChange={(e) => setSiteLat(e.target.value)}
                        placeholder="e.g. 40.7128"
                        className="app-input"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-muted">Longitude</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={siteLng}
                        onChange={(e) => setSiteLng(e.target.value)}
                        placeholder="e.g. -74.0060"
                        className="app-input"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    disabled={isGettingLocation}
                    className="flex min-h-[44px] touch-manipulation items-center gap-2 rounded-2xl border border-primary/50 bg-primary/20 px-4 py-2 text-sm font-medium text-primary"
                  >
                    {isGettingLocation ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        Getting location...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-lg">my_location</span>
                        Use my location
                      </>
                    )}
                  </button>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Radius (meters)
                    </label>
                    <input
                      type="number"
                      min="10"
                      step="10"
                      value={siteRadiusMeters}
                      onChange={(e) => setSiteRadiusMeters(e.target.value)}
                      className="app-input"
                      placeholder="200"
                    />
                    <p className="mt-1 text-[10px] text-subtle">
                      Minimum 10 m. Employees must be within this distance to clock in.
                    </p>
                  </div>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={enforceOnSiteAtLogin}
                      onChange={(e) => setEnforceOnSiteAtLogin(e.target.checked)}
                      className="size-5 rounded border-line-strong bg-overlay/5"
                    />
                    <span className="text-sm text-white">
                      Also require on-site at login (block app until on site)
                    </span>
                  </label>
                </>
              )}
            </div>
            {/* Shelf / Bin Reconcile */}
            {isAdmin && (
              <div className="app-list-row p-4">
                <h2 className="mb-1 text-sm font-semibold text-white">Shelf / Bin Reconcile</h2>
                <p className="mb-3 text-[10px] text-subtle">
                  Clear a shelf to remove bin location from all jobs and inventory at that bin. Use
                  Kanban bulk select + &quot;Set bin&quot; to assign multiple jobs to one location.
                </p>
                {binsWithCounts.length === 0 ? (
                  <p className="text-sm text-muted">No bins in use.</p>
                ) : (
                  <ul className="space-y-2">
                    {binsByRack.map(({ rack, bins, jobTotal, inventoryTotal }) => {
                      const isOpen = openRacks.has(rack);
                      return (
                        <li
                          key={rack}
                          className="overflow-hidden rounded border border-line bg-overlay/5"
                        >
                          <button
                            type="button"
                            onClick={() => toggleRack(rack)}
                            aria-expanded={isOpen}
                            className="flex w-full items-center gap-2 p-2 text-left transition-colors hover:bg-overlay/5"
                          >
                            <span
                              aria-hidden="true"
                              className={`material-symbols-outlined text-base text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            >
                              chevron_right
                            </span>
                            <span className="font-mono text-sm font-bold text-primary">
                              Rack {rack}
                            </span>
                            <span className="text-[10px] text-muted">
                              {bins.length} bin(s) · {jobTotal} job(s) · {inventoryTotal} item(s)
                            </span>
                          </button>
                          {isOpen && (
                            <ul className="space-y-2 border-t border-line p-2">
                              {bins.map(({ bin, jobIds, inventoryIds }) => (
                                <li
                                  key={bin}
                                  className="flex items-center justify-between gap-3 rounded border border-line bg-overlay/5 p-2"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono font-semibold text-primary">
                                      {bin}
                                    </span>
                                    <p className="text-[10px] text-muted">
                                      {jobIds.length} job(s), {inventoryIds.length} inventory
                                      item(s)
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={clearingBin === bin}
                                    onClick={() => handleClearShelf(bin)}
                                    className="shrink-0 rounded-lg border border-danger/40 bg-danger/20 px-2 py-1.5 text-xs font-bold text-danger-fg transition-colors hover:bg-danger/30 disabled:opacity-50"
                                  >
                                    {clearingBin === bin ? 'Clearing…' : 'Clear shelf'}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="app-btn app-btn-primary mt-4 w-full py-2.5 text-sm"
            >
              {isSyncing ? 'Saving...' : 'Save'}
            </button>
          </div>

          {isAdmin && (
            <div className="app-list-row p-4">
              <h2 className="mb-4 text-sm font-semibold text-white">Security</h2>
              <p className="mb-4 text-xs text-muted">
                Two-factor authentication adds a one-time code at login. Use &quot;Reset 2FA&quot;
                on a user above to recover an account that&apos;s locked out of its authenticator.
              </p>
              <div className="space-y-4">
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={requireMfa}
                    onChange={(e) => setRequireMfa(e.target.checked)}
                    className="size-5 rounded border-line-strong bg-overlay/5"
                  />
                  <span className="text-sm text-white">
                    Require two-factor authentication (administrators)
                  </span>
                </label>
                <p className="text-[10px] text-subtle">
                  When on, affected users must enroll and pass 2FA at login. Turn this off as an
                  emergency kill-switch (e.g. an authenticator outage) to unblock logins.
                </p>
              </div>
              <button
                onClick={handleSave}
                disabled={isSyncing}
                className="app-btn app-btn-primary mt-4 w-full py-2.5 text-sm"
              >
                {isSyncing ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
