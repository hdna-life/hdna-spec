import { describe, expect, it } from 'vitest';
import { ALLOWED_PRIORITIES_BY_MODE } from '../../src/governor/mode-priorities';

describe('ALLOWED_PRIORITIES_BY_MODE', () => {
  it('always allows P0 in every mode', () => {
    for (const mode of ['INTERACTIVE', 'BACKGROUND', 'DEEP_IDLE'] as const) {
      expect(ALLOWED_PRIORITIES_BY_MODE[mode]).toContain('P0');
    }
  });

  it('restricts INTERACTIVE to cheap jobs only, excluding P2/P3', () => {
    expect(ALLOWED_PRIORITIES_BY_MODE.INTERACTIVE).toEqual(['P0', 'P1']);
  });

  it('allows BACKGROUND to run P2 but not P3', () => {
    expect(ALLOWED_PRIORITIES_BY_MODE.BACKGROUND).toContain('P2');
    expect(ALLOWED_PRIORITIES_BY_MODE.BACKGROUND).not.toContain('P3');
  });

  it('allows DEEP_IDLE to run every priority class', () => {
    expect(ALLOWED_PRIORITIES_BY_MODE.DEEP_IDLE).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('is a strictly widening set: INTERACTIVE ⊆ BACKGROUND ⊆ DEEP_IDLE', () => {
    const interactive = new Set(ALLOWED_PRIORITIES_BY_MODE.INTERACTIVE);
    const background = new Set(ALLOWED_PRIORITIES_BY_MODE.BACKGROUND);
    const deepIdle = new Set(ALLOWED_PRIORITIES_BY_MODE.DEEP_IDLE);

    for (const p of interactive) expect(background.has(p)).toBe(true);
    for (const p of background) expect(deepIdle.has(p)).toBe(true);
  });
});
