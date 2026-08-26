import type { ExpressionSheet } from '@spec/schema/expression-sheet';
import type { WritingSample } from '@spec/schema/writing-sample';
import type { StorageAdapter } from '../storage/types';
import { compileExpressionSheet } from './expression-sheet-compiler';

const PERSONA_STORE = 'persona';
const EXPRESSION_SHEET_KEY = 'expression_sheet';

/**
 * Persisted Expression Sheet. Classified DERIVED: it is fully reproducible
 * from the canonical writing samples at any time via recompile().
 */
export class ExpressionSheetStore {
  constructor(private storage: StorageAdapter) {}

  get(): Promise<ExpressionSheet | undefined> {
    return this.storage.get<ExpressionSheet>(PERSONA_STORE, EXPRESSION_SHEET_KEY);
  }

  async recompile(samples: WritingSample[]): Promise<ExpressionSheet> {
    const sheet = compileExpressionSheet(samples.map((s) => s.text));
    await this.storage.put(PERSONA_STORE, EXPRESSION_SHEET_KEY, sheet, 'DERIVED');
    return sheet;
  }
}
