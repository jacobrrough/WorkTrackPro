import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockClockIn = vi.fn();
const mockClockOut = vi.fn();
const mockGetAllShifts = vi.fn();
const mockGetShiftOpenState = vi.fn();

vi.mock('@/services/api/shifts', () => ({
  shiftService: {
    clockIn: (...args: unknown[]) => mockClockIn(...args),
    clockOut: (...args: unknown[]) => mockClockOut(...args),
    getAllShifts: (...args: unknown[]) => mockGetAllShifts(...args),
    getShiftOpenState: (...args: unknown[]) => mockGetShiftOpenState(...args),
  },
}));

// Prevent Supabase client initialization (requires env vars not present in CI).
// syncOfflineClockQueue calls supabase.auth.getSession() as a session guard;
// mock it to return a live session so the queue logic runs normally in tests.
vi.mock('@/services/api/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test' } } } }),
    },
  },
}));

import { syncOfflineClockQueue } from './syncOfflineClockQueue';
import { enqueueClockPunch, getQueue } from './offlineQueue';

describe('syncOfflineClockQueue', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
    mockClockIn.mockReset();
    mockClockOut.mockReset();
    mockGetAllShifts.mockReset();
    mockGetShiftOpenState.mockReset();
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('removes clock_in from queue only when clockIn returns true', async () => {
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'u1',
      jobId: 'j1',
      timestamp: new Date().toISOString(),
    });
    mockClockIn.mockResolvedValueOnce(false);
    // No open shift exists yet, so the false result is a genuine "still queued" case.
    mockGetAllShifts.mockResolvedValueOnce([]);
    const refreshShifts = vi.fn();
    const refreshJobs = vi.fn();
    const synced = await syncOfflineClockQueue({ refreshShifts, refreshJobs });
    expect(synced).toBe(0);
    expect(getQueue()).toHaveLength(1);

    mockClockIn.mockResolvedValueOnce(true);
    const synced2 = await syncOfflineClockQueue({ refreshShifts, refreshJobs });
    expect(synced2).toBe(1);
    expect(getQueue()).toHaveLength(0);
  });

  it('reconciles a lost-ACK clock_in: clears when an open same-job shift already exists', async () => {
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'u1',
      jobId: 'j1',
      timestamp: new Date().toISOString(),
    });
    // The punch actually succeeded server-side (lost ACK), so clockIn now reports
    // the user already has an open shift (returns false). Reconcile must clear it.
    mockClockIn.mockResolvedValueOnce(false);
    mockGetAllShifts.mockResolvedValueOnce([
      { id: 's1', user: 'u1', job: 'j1', clockInTime: '2026-06-02T00:00:00.000Z' },
    ]);
    const synced = await syncOfflineClockQueue({
      refreshShifts: vi.fn(),
      refreshJobs: vi.fn(),
    });
    expect(synced).toBe(1);
    expect(getQueue()).toHaveLength(0);
  });

  it('keeps a clock_in queued when the only open shift is for a different job', async () => {
    enqueueClockPunch({
      type: 'clock_in',
      userId: 'u1',
      jobId: 'j1',
      timestamp: new Date().toISOString(),
    });
    mockClockIn.mockResolvedValueOnce(false);
    // Open shift exists but for a different job — do NOT auto job-switch on replay.
    mockGetAllShifts.mockResolvedValueOnce([
      { id: 's2', user: 'u1', job: 'j2', clockInTime: '2026-06-02T00:00:00.000Z' },
    ]);
    const synced = await syncOfflineClockQueue({
      refreshShifts: vi.fn(),
      refreshJobs: vi.fn(),
    });
    expect(synced).toBe(0);
    expect(getQueue()).toHaveLength(1);
    expect(mockClockOut).not.toHaveBeenCalled();
  });

  it('dequeues clock_out when shift is already closed', async () => {
    enqueueClockPunch({
      type: 'clock_out',
      userId: 'u1',
      timestamp: new Date().toISOString(),
      shiftId: 's1',
    });
    mockGetShiftOpenState.mockResolvedValueOnce({ exists: true, open: false });
    const synced = await syncOfflineClockQueue({
      refreshShifts: vi.fn(),
      refreshJobs: vi.fn(),
    });
    expect(synced).toBe(1);
    expect(mockClockOut).not.toHaveBeenCalled();
    expect(getQueue()).toHaveLength(0);
  });
});
