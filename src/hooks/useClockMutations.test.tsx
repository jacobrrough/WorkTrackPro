import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Shift } from '@/core/types';

/**
 * Mock the service barrels so clockOut runs without a Supabase round-trip. The hook
 * imports shiftService (shifts) + jobService (jobs); both modules pull in the Supabase
 * client at import time, so each must be mocked. We also mock offlineQueue to assert
 * whether a punch was enqueued.
 */
const mockEndLunch = vi.fn<(shiftId: string, minutes?: number) => Promise<boolean>>();
const mockClockOut = vi.fn<(shiftId: string) => Promise<void>>();

vi.mock('@/services/api/shifts', () => ({
  shiftService: {
    endLunch: (shiftId: string, minutes?: number) => mockEndLunch(shiftId, minutes),
    clockOut: (shiftId: string) => mockClockOut(shiftId),
  },
}));

vi.mock('@/services/api/jobs', () => ({
  jobService: {},
}));

const mockEnqueue = vi.fn();
const mockOnEnqueued = vi.fn();
vi.mock('@/lib/offlineQueue', () => ({
  enqueueClockPunch: (...args: unknown[]) => mockEnqueue(...args),
}));

import { useClockMutations } from './useClockMutations';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** An active shift with an open (un-ended) lunch window. */
function shiftWithOpenLunch(): Shift {
  return {
    id: 's1',
    user: 'u1',
    job: 'j1',
    clockInTime: '2026-06-03T08:00:00.000Z',
    // Lunch started 30 minutes ago and has NOT ended yet.
    lunchStartTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    lunchEndTime: undefined,
  } as Shift;
}

function renderClockOut(activeShift: Shift) {
  const refreshShifts = vi.fn().mockResolvedValue(undefined);
  const refreshJobs = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(
    () =>
      useClockMutations({
        currentUser: { id: 'u1' },
        shifts: [activeShift],
        jobs: [],
        activeShift,
        refreshShifts,
        refreshJobs,
        onOfflinePunchEnqueued: mockOnEnqueued,
      }),
    { wrapper }
  );
  return { result, refreshShifts, refreshJobs };
}

describe('useClockMutations.clockOut — open-lunch endLunch retry', () => {
  beforeEach(() => {
    mockEndLunch.mockReset();
    mockClockOut.mockReset();
    mockEnqueue.mockReset();
    mockOnEnqueued.mockReset();
  });

  it('retries endLunch once with the same snapshotted minutes and clocks out on the 2nd attempt', async () => {
    // First endLunch write fails (transient), second succeeds.
    mockEndLunch.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockClockOut.mockResolvedValue(undefined);

    const { result } = renderClockOut(shiftWithOpenLunch());
    let outcome: { ok: boolean; queued: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.clockOut();
    });

    // endLunch attempted twice; the SAME snapshotted minute value both times (no recompute).
    expect(mockEndLunch).toHaveBeenCalledTimes(2);
    const firstMinutes = mockEndLunch.mock.calls[0][1];
    const secondMinutes = mockEndLunch.mock.calls[1][1];
    expect(secondMinutes).toBe(firstMinutes);
    expect(firstMinutes).toBe(30);

    // Retry succeeded → normal clock-out proceeds, nothing queued, success.
    expect(mockClockOut).toHaveBeenCalledTimes(1);
    expect(mockClockOut).toHaveBeenCalledWith('s1');
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, queued: false });
  });

  it('falls back to an offline clock_out punch when both endLunch attempts fail', async () => {
    mockEndLunch.mockResolvedValue(false);

    const { result } = renderClockOut(shiftWithOpenLunch());
    let outcome: { ok: boolean; queued: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.clockOut();
    });

    // Two attempts, then give up — clockOut is NOT issued, punch is queued.
    expect(mockEndLunch).toHaveBeenCalledTimes(2);
    expect(mockClockOut).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clock_out', userId: 'u1', shiftId: 's1' })
    );
    expect(mockOnEnqueued).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: false, queued: true });
  });
});
