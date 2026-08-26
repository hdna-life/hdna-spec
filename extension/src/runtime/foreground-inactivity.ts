export interface ForegroundInactivityUpdate {
  /** Next value to persist via RuntimeStatusStore — undefined while foreground is active. */
  foregroundInactiveSince: string | undefined;
  /** Elapsed ms since foregroundInactiveSince; 0 while foreground is active. */
  inactiveDurationMs: number;
}

/**
 * Pure state-transition function for tracking foreground inactivity across
 * MV3 service-worker restarts. `ForegroundTracker.isActive` correctly
 * resets to `false` on every service-worker restart (a live
 * `chrome.runtime.Port` keeps the worker alive, so by the time it's
 * actually terminated the foreground genuinely is inactive) — that part
 * isn't the bug. The bug was measuring *how long* it's been inactive with
 * an in-memory tick counter, which resets to 0 on every restart right along
 * with everything else in the closure, so sustained-idleness thresholds
 * phrased in ticks could never be reached if the worker didn't survive
 * between dispatch alarms.
 *
 * This function fixes that by turning "how long inactive" into a wall-clock
 * calculation against a *persisted* timestamp instead of a counter: once
 * inactivity starts, `foregroundInactiveSince` is set once and then left
 * alone (re-read from storage on every call, on every worker restart) until
 * foreground becomes active again, at which point it's cleared. Duration is
 * always `now - foregroundInactiveSince`, correct on any wake, restart or
 * not. See docs/decisions/0014.
 *
 * `nowMs` is an explicit parameter (not read internally via `Date.now()`)
 * so this stays a pure, deterministically testable function; the runtime
 * boundary (`background.ts`) supplies real wall-clock time and persists the
 * returned `foregroundInactiveSince` back via `RuntimeStatusStore`.
 */
export function computeForegroundInactivity(
  previousInactiveSince: string | undefined,
  foregroundActive: boolean,
  nowMs: number,
): ForegroundInactivityUpdate {
  if (foregroundActive) {
    return { foregroundInactiveSince: undefined, inactiveDurationMs: 0 };
  }

  const foregroundInactiveSince = previousInactiveSince ?? new Date(nowMs).toISOString();
  return { foregroundInactiveSince, inactiveDurationMs: nowMs - Date.parse(foregroundInactiveSince) };
}
