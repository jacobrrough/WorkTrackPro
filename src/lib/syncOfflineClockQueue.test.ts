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
