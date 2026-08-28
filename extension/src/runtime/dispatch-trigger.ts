/**
 * Message type a foreground surface (Dashboard/popup) sends via
 * `chrome.runtime.sendMessage` to ask the background service worker to run
 * one queue-dispatch tick immediately, instead of waiting for the next
 * `hdna-dispatch` alarm (which fires at most every 30s — `background.ts`'s
 * `chrome.alarms.create(DISPATCH_ALARM, { periodInMinutes: 0.5 })`).
 *
 * Exists specifically for explicit, one-shot, operator-triggered actions
 * that enqueue a job and expect to see it start right away — e.g. Trial
 * 4's "Run next case" button (`Trial4BenchmarkPanel.svelte`). Without this,
 * such a click could sit PENDING for up to 30s (or longer, if the service
 * worker had been suspended and the alarm hadn't fired yet), which reads to
 * the operator as the button silently doing nothing.
 *
 * This does NOT bypass the governor's mode/priority gating
 * (`ALLOWED_PRIORITIES_BY_MODE`) or the processing-paused control — it
 * only asks for the SAME dispatch tick the alarm would have run, sooner.
 * A job whose priority the current mode doesn't allow still won't run
 * until the mode allows it.
 */
export const DISPATCH_TRIGGER_MESSAGE_TYPE = 'hdna-trigger-dispatch';

export interface DispatchTriggerMessage {
  type: typeof DISPATCH_TRIGGER_MESSAGE_TYPE;
}
