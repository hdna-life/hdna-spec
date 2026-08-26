import { describe, expect, it } from 'vitest';
import { deriveT2PanelState } from '../../src/persona/t2-panel-state';
import type { T2Profile } from '@spec/schema/t2-profile';

const AGGREGATE = { weightedMeanScore: 0.5, totalConfidenceWeight: 1, sampleCount: 1 };

describe('deriveT2PanelState', () => {
  it('reports no-evidence when there is no profile and no evidence at all', () => {
    const state = deriveT2PanelState({ evidenceCount: 0, classifiedCount: 0, profile: undefined });
    expect(state).toEqual({ kind: 'no-evidence' });
  });

  it('reports abstained when evidence exists but the classifier produced no T2 dimensions', () => {
    const state = deriveT2PanelState({ evidenceCount: 35, classifiedCount: 0, profile: undefined });
    expect(state).toEqual({ kind: 'abstained', evidenceCount: 35, classifiedCount: 0 });
  });

  it('reports abstained when a profile exists but has neither formality nor directness', () => {
    const profile: T2Profile = { updatedAt: '2026-01-01T00:00:00.000Z' };
    const state = deriveT2PanelState({ evidenceCount: 35, classifiedCount: 0, profile });
    expect(state).toEqual({ kind: 'abstained', evidenceCount: 35, classifiedCount: 0 });
  });

  it('reports classified when the profile has a formality observation', () => {
    const profile: T2Profile = { formality: AGGREGATE, updatedAt: '2026-01-01T00:00:00.000Z' };
    const state = deriveT2PanelState({ evidenceCount: 35, classifiedCount: 5, profile });
    expect(state).toEqual({ kind: 'classified' });
  });

  it('reports classified when the profile has a directness observation', () => {
    const profile: T2Profile = { directness: AGGREGATE, updatedAt: '2026-01-01T00:00:00.000Z' };
    const state = deriveT2PanelState({ evidenceCount: 35, classifiedCount: 5, profile });
    expect(state).toEqual({ kind: 'classified' });
  });

  it('prefers classified over abstained even if evidenceCount looks stale/zero', () => {
    const profile: T2Profile = { formality: AGGREGATE, updatedAt: '2026-01-01T00:00:00.000Z' };
    const state = deriveT2PanelState({ evidenceCount: 0, classifiedCount: 0, profile });
    expect(state).toEqual({ kind: 'classified' });
  });
});
