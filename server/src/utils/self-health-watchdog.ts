/**
 * Self-health watchdog
 *
 * Polls a local /healthz URL at a fixed interval, tracks consecutive
 * failures, and dispatches a `system.healthz_down` notification after
 * the configured failure threshold is reached.  Resets the counter on
 * any successful response.  Errors during fetch are treated as failures.
 *
 * Returns a `stop()` function that clears the interval.
 */

export interface SelfHealthWatchdogOptions {
  /** URL to poll (e.g. 'http://localhost:3001/healthz') */
  url: string;
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Number of consecutive failures before dispatching an alert */
  failureThreshold: number;
  /** Notification dispatch function (matches dispatchNotification signature) */
  dispatch: (event: string, payload: Record<string, unknown>) => Promise<void>;
  /**
   * Optional fetch override — defaults to global fetch.
   * Injected by tests for deterministic control.
   */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number }>;
}

export interface SelfHealthWatchdogState {
  url: string | null;
  running: boolean;
  lastOk: boolean | null;
  lastStatus: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  alertDispatched: boolean;
}

const watchdogState: SelfHealthWatchdogState = {
  url: null,
  running: false,
  lastOk: null,
  lastStatus: null,
  lastError: null,
  lastCheckedAt: null,
  consecutiveFailures: 0,
  alertDispatched: false,
};

export function getSelfHealthWatchdogState(): SelfHealthWatchdogState {
  return { ...watchdogState };
}

export function startSelfHealthWatchdog(opts: SelfHealthWatchdogOptions): () => void {
  const {
    url,
    intervalMs,
    failureThreshold,
    dispatch,
  } = opts;
  const fetchFn: (url: string) => Promise<{ ok: boolean; status: number }> =
    opts.fetch !== undefined
      ? opts.fetch
      : (u: string) => (globalThis as any).fetch(u) as Promise<{ ok: boolean; status: number }>;

  let consecutiveFailures = 0;
  let dispatched = false;

  Object.assign(watchdogState, {
    url,
    running: true,
    lastOk: null,
    lastStatus: null,
    lastError: null,
    lastCheckedAt: null,
    consecutiveFailures,
    alertDispatched: dispatched,
  });

  const check = async () => {
    let ok = false;
    let status: number | null = null;
    let errorMsg: string | undefined;
    try {
      const res = await fetchFn(url);
      ok = res.ok;
      status = res.status;
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : String(err);
      ok = false;
    }

    if (ok) {
      consecutiveFailures = 0;
      dispatched = false;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold && !dispatched) {
        dispatched = true;
        const payload: Record<string, unknown> = {
          url,
          consecutiveFailures,
          checkedAt: new Date().toISOString(),
        };
        if (errorMsg) payload.error = errorMsg;
        void dispatch('system.healthz_down', payload).catch(() => {});
      }
    }

    Object.assign(watchdogState, {
      url,
      running: true,
      lastOk: ok,
      lastStatus: status,
      lastError: errorMsg || null,
      lastCheckedAt: new Date().toISOString(),
      consecutiveFailures,
      alertDispatched: dispatched,
    });
  };

  const timer = setInterval(() => { void check(); }, intervalMs);

  return () => {
    clearInterval(timer);
    watchdogState.running = false;
  };
}
