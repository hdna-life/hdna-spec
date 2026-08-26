/**
 * Logical `.hdna` package manifest shape, per the design doc's "Önerilen
 * HDNA Proje / Paket Klasör Standardı" section. Typing only — no compiler,
 * no export pipeline exists in the MVP foundation (Phase 8/9, SPEC_RESERVED).
 */
export interface HdnaManifest {
  packageId: string;
  schemaVersion: string;
  /** Relative logical paths present in this package, e.g. "identity/facts.json". */
  capabilities: string[];
  /** Content hashes keyed by logical path, for integrity verification. */
  artifactHashes: Record<string, string>;
  createdAt: string;
}
