/**
 * Self-health watchdog tests (RED → GREEN → REFACTOR)
 *
 * The watchdog polls a local /healthz URL on a fixed interval, tracks
 * consecutive failures, and dispatches a `system.healthz_down` notification
 * after N consecutive failures (default 3). It resets the counter on success.
 *
 * Strict TDD: tests written before implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Self-health watchdog function under test — does not exist yet (RED)
import { getSelfHealthWatchdogState, startSelfHealthWatchdog } from './self-health-watchdog';

describe('startSelfHealthWatchdog', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    dispatchMock = vi.fn().mockResolvedValue(undefined);
    fetchMock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('dispatches system.healthz_down after 3 consecutive failures', async () => {
    // Always return a non-ok response (simulate healthz down)
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    // Advance through 3 check intervals
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith('system.healthz_down', expect.objectContaining({
      consecutiveFailures: 3,
      url: 'http://localhost:3001/healthz',
    }));

    stop();
  });

  it('does not dispatch if failures are below the threshold', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    // Only 2 intervals — not yet at threshold
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(dispatchMock).not.toHaveBeenCalled();
    stop();
  });

  it('dispatches exactly once per failure burst (not on every tick after threshold)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    // Run 6 intervals (threshold 3 — should only dispatch once at tick 3, not again at 4-6)
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('resets consecutive failure count after a success', async () => {
    // Fail twice, succeed, then fail 3 more times → dispatch once
    let callCount = 0;
    fetchMock.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2 || callCount === 4 || callCount === 5) {
        return { ok: false, status: 503 };
      }
      // call 3 = success, calls 6-8 = failures
      if (callCount === 3) return { ok: true, status: 200 };
      return { ok: false, status: 503 };
    });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    // 2 failures → success resets → 3 more failures → dispatch
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    // Dispatch should fire once at tick 6 (3 failures post-reset: ticks 4, 5, 6)
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('returns a stop function that clears the interval', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    // Run 2 ticks, then stop, then run 5 more — dispatch should never fire
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    stop();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('swallows fetch errors and counts them as failures', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith('system.healthz_down', expect.objectContaining({
      consecutiveFailures: 3,
      error: expect.stringContaining('ECONNREFUSED'),
    }));
    stop();
  });

  it('records the latest watchdog status for readiness visibility', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const stop = startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 1000,
      failureThreshold: 3,
      dispatch: dispatchMock,
      fetch: fetchMock,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(getSelfHealthWatchdogState()).toMatchObject({
      url: 'http://localhost:3001/healthz',
      running: true,
      lastOk: false,
      lastStatus: 503,
      consecutiveFailures: 1,
      alertDispatched: false,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(getSelfHealthWatchdogState()).toMatchObject({
      running: true,
      lastOk: true,
      lastStatus: 200,
      consecutiveFailures: 0,
      alertDispatched: false,
    });

    stop();
    expect(getSelfHealthWatchdogState()).toMatchObject({ running: false });
  });
});
