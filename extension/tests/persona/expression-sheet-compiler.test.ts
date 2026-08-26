import { describe, expect, it } from 'vitest';
import { compileExpressionSheet } from '../../src/persona/expression-sheet-compiler';
import { EXPRESSION_SHEET_FIELD_STATUS } from '@spec/schema/expression-sheet';

describe('compileExpressionSheet', () => {
  it('populates only MVP_REQUIRED fields, never SPEC_RESERVED ones', () => {
    const sheet = compileExpressionSheet(['hello world. how are you?'], () => '2026-01-01T00:00:00.000Z');

    for (const [field, status] of Object.entries(EXPRESSION_SHEET_FIELD_STATUS)) {
      const value = sheet[field as keyof typeof sheet];
      if (status === 'SPEC_RESERVED') {
        expect(value, `${field} is SPEC_RESERVED and must stay unpopulated`).toBeUndefined();
      } else {
        expect(value, `${field} is MVP_REQUIRED and should be populated`).toBeDefined();
      }
    }
  });

  it('uses the injected clock for updatedAt', () => {
    const sheet = compileExpressionSheet(['hi.'], () => '2026-01-01T00:00:00.000Z');
    expect(sheet.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves every stat field undefined for an empty sample set', () => {
    const sheet = compileExpressionSheet([], () => '2026-01-01T00:00:00.000Z');
    expect(sheet.sentenceLengthTokens).toBeUndefined();
    expect(sheet.punctuationPer100Sentences).toBeUndefined();
    expect(sheet.lowercaseStartProbability).toBeUndefined();
    expect(sheet.emojiUsageRate).toBeUndefined();
  });
});
