/**
 * Storage classification per HDNA design doc ("Storage policy").
 * Governs deletion priority under storage pressure:
 *   CACHE -> rebuildable DERIVED -> prunable RAW -> CANONICAL (only by explicit user policy)
 */
export type StorageClass = 'CANONICAL' | 'DERIVED' | 'CACHE' | 'RAW';

/** Deletion priority order under storage pressure, least-precious first. */
export const STORAGE_CLASS_DELETION_ORDER: readonly StorageClass[] = [
  'CACHE',
  'DERIVED',
  'RAW',
  'CANONICAL',
];
