import { describe, expect, it } from 'vitest';
import { admitJudgment } from '../../src/persona/semantic-revision-admission';
import type { RevisionIntervention } from '../../src/persona/revision-intervention';
import type { SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

function intervention(overrides: Partial<RevisionIntervention> = {}): RevisionIntervention {
  return {
    id: 'edit_event:e1#0',
    sourceEvidenceId: 'edit_event:e1',
    kind: 'added',
    originalText: '',
    finalText: 'X',
    beforeContext: 'A',
    afterContext: 'B',
    ...overrides,
  };
}

describe('admitJudgment', () => {
  it('rejects no_meaningful_change', () => {
    const judgment: SemanticRevisionJudgmentDraft = { verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 };
    expect(admitJudgment(intervention(), judgment, 'unscoped')).toBeNull();
  });

  it('rejects uncertain', () => {
    const judgment: SemanticRevisionJudgmentDraft = { verdict: 'uncertain', dimensions: [], description: null, confidence: 0.3 };
    expect(admitJudgment(intervention(), judgment, 'unscoped')).toBeNull();
  });

  it('rejects a structurally invalid judgment (missing description on a change verdict)', () => {
    const judgment: SemanticRevisionJudgmentDraft = { verdict: 'meaning_added', dimensions: [], description: null, confidence: 0.7 };
    expect(admitJudgment(intervention(), judgment, 'unscoped')).toBeNull();
  });

  it('rejects a structurally invalid judgment (out-of-range confidence)', () => {
    const judgment: SemanticRevisionJudgmentDraft = { verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 5 };
    expect(admitJudgment(intervention(), judgment, 'unscoped')).toBeNull();
  });

  it('admits meaning_added on an "added" intervention as behavioral_delta, with HDNA-supplied context', () => {
    const judgment: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_added',
      dimensions: [],
      description: 'Introduced an explicit constraint.',
      confidence: 0.8,
    };
    const draft = admitJudgment(intervention({ kind: 'added' }), judgment, 'unscoped');
    expect(draft).not.toBeNull();
    expect(draft!.kind).toBe('behavioral_delta');
    expect(draft!.observation).toBe('Introduced an explicit constraint.');
    expect(draft!.preferred).toBeUndefined();
    expect(draft!.rejected).toBeUndefined();
    expect(draft!.context).toBe('unscoped');
    expect(draft!.confidence).toBe(0.8);
  });

  it('admits meaning_removed on a "removed" intervention as behavioral_delta', () => {
    const judgment: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_removed',
      dimensions: [],
      description: 'Removed an explicit hedge.',
      confidence: 0.6,
    };
    const draft = admitJudgment(intervention({ kind: 'removed', originalText: 'X', finalText: '' }), judgment, 'unscoped');
    expect(draft!.kind).toBe('behavioral_delta');
  });

  it('admits meaning_transformed on a "reordered" intervention as behavioral_delta (not contrastive_preference)', () => {
    const judgment: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_transformed',
      dimensions: [],
      description: 'Reordered emphasis.',
      confidence: 0.5,
    };
    const draft = admitJudgment(
      intervention({ kind: 'reordered', originalText: 'X Y', finalText: 'Y X' }),
      judgment,
      'unscoped',
    );
    expect(draft!.kind).toBe('behavioral_delta');
  });

  it('admits meaning_transformed on a "replaced" intervention as contrastive_preference with preferred=finalText, rejected=originalText', () => {
    const judgment: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_transformed',
      dimensions: [],
      description: 'Shifted from broad to specific framing.',
      confidence: 0.85,
    };
    const draft = admitJudgment(
      intervention({ kind: 'replaced', originalText: 'broad framing', finalText: 'specific framing' }),
      judgment,
      'unscoped',
    );
    expect(draft!.kind).toBe('contrastive_preference');
    expect(draft!.preferred).toBe('specific framing');
    expect(draft!.rejected).toBe('broad framing');
    expect(draft!.observation).toBe('Shifted from broad to specific framing.');
  });

  it('IDs/provenance are never taken from the judgment draft — HDNA-generated fields are not present in the draft output', () => {
    const judgment: SemanticRevisionJudgmentDraft = {
      verdict: 'meaning_added',
      dimensions: [],
      description: 'Something added.',
      confidence: 0.5,
    };
    const draft = admitJudgment(intervention(), judgment, 'unscoped');
    expect(draft).not.toHaveProperty('id');
    expect(draft).not.toHaveProperty('extractorId');
    expect(draft).not.toHaveProperty('extractorVersion');
    expect(draft).not.toHaveProperty('computedAt');
  });
});
