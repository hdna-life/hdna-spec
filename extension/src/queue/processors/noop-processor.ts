/**
 * Trivial synthetic job processor used only to exercise the queue pipeline
 * (enqueue -> persist -> dequeue -> execute -> complete) deterministically in
 * tests. Not a real capture/telemetry job — see MVP scope notes.
 */
export async function noopProcessor(_payload: unknown): Promise<void> {
  // Intentionally does nothing.
}
