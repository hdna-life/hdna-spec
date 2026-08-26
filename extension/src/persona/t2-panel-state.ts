import type { T2Profile } from '@spec/schema/t2-profile';

/**
 * UI-facing summary of "what should the T2 panel show" — kept separate from
 * T2Profile/TraitScoreRecord because the classifier abstaining on all
 * evidence (e.g. non-English text, see t2-classifier.ts) is indistinguishable
 * from "no evidence submitted" when looking at T2Profile alone.
 */
export type T2PanelState =
  | { kind: 'no-evidence' }
  | { kind: 'abstained'; evidenceCount: number; classifiedCount: number }
  | { kind: 'classified' };

export function deriveT2PanelState(params: {
  evidenceCount: number;
  classifiedCount: number;
  profile: T2Profile | undefined;
}): T2PanelState {
  const hasObservations = Boolean(params.profile && (params.profile.formality || params.profile.directness));
  if (hasObservations) return { kind: 'classified' };
  if (params.evidenceCount === 0) return { kind: 'no-evidence' };
  return { kind: 'abstained', evidenceCount: params.evidenceCount, classifiedCount: params.classifiedCount };
}
