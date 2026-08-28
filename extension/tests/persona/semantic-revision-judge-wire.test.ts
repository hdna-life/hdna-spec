import { describe, expect, it } from 'vitest';
import { buildNarrowJudgePrompt, parseUntrustedJudgmentText } from '../../src/persona/semantic-revision-judge-wire';
import type { SemanticRevisionJudgeInput } from '@spec/protocol/semantic-revision-judge';

const input: SemanticRevisionJudgeInput = {
  kind: 'replaced',
  originalText: 'broad framing',
  finalText: 'specific framing',
  beforeContext: 'A generic statement using',
  afterContext: 'to describe the plan.',
};

describe('semantic-revision-judge-wire', () => {
  describe('buildNarrowJudgePrompt', () => {
    it('includes the operation kind', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toContain(input.kind);
      expect(prompt).toContain('Operation:');
    });

    it('includes the original/final spans', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toContain(input.originalText);
      expect(prompt).toContain(input.finalText);
      expect(prompt).toContain('Original span:');
      expect(prompt).toContain('Final span:');
    });

    it('includes before/after context', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toContain(input.beforeContext);
      expect(prompt).toContain(input.afterContext);
      expect(prompt).toContain('Context before:');
      expect(prompt).toContain('Context after:');
    });

    it('does not mention any named language (Turkish/English)', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).not.toMatch(/turkish/i);
      expect(prompt).not.toMatch(/\benglish\b/i);
    });

    it('does not mention morpheme-level terminology (language-specific morphology)', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).not.toMatch(/morpheme/i);
    });

    it('is language-general: reasons about meaning shift itself, not language-specific wording', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/language/i);
      expect(prompt).toMatch(/meaning/i);
      expect(prompt).not.toMatch(/grammatical/i);
    });

    it('instructs the model to respond with exactly one JSON object and nothing else', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/EXACTLY one JSON object/i);
      expect(prompt).toMatch(/no extra text/i);
    });

    it('lists the four required keys: verdict, dimensions, description, confidence', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toContain('"verdict"');
      expect(prompt).toContain('"dimensions"');
      expect(prompt).toContain('"description"');
      expect(prompt).toContain('"confidence"');
    });

    it('describes the two axes as separate questions (semantic verdict vs. observable behavior)', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/TWO SEPARATE questions/i);
      expect(prompt).toMatch(/SEMANTIC\/PRACTICAL VERDICT/i);
      expect(prompt).toMatch(/OBSERVABLE BEHAVIORAL DIMENSIONS/i);
    });

    it('lists every allowed dimension and direction value', () => {
      const prompt = buildNarrowJudgePrompt(input);
      for (const dimension of [
        'expressed_affect_valence',
        'expressed_affect_intensity',
        'directness',
        'politeness',
        'formality',
        'certainty',
        'evidentiality',
        'commitment',
        'directive_force',
        'conditionality',
        'scope',
        'specificity',
        'rationale',
        'factual_content',
        'action_or_decision',
      ]) {
        expect(prompt).toContain(dimension);
      }
      for (const direction of [
        'increased',
        'decreased',
        'more_positive',
        'more_negative',
        'added',
        'removed',
        'narrowed',
        'expanded',
        'changed',
      ]) {
        expect(prompt).toContain(direction);
      }
    });

    it('instructs the model never to infer hidden emotion/psychology, only expressed wording', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/DIRECTLY OBSERVABLE/i);
      expect(prompt).toMatch(/never infer the human.s actual internal emotion/i);
    });

    it('instructs that dimensions may be empty and must never repeat', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/may be empty/i);
      expect(prompt).toMatch(/[Nn]ever include the same dimension twice/i);
    });

    it('instructs that uncertain must have an empty dimensions array', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toMatch(/verdict is "uncertain", dimensions must be an empty array/i);
    });
  });

  describe('parseUntrustedJudgmentText', () => {
    describe('valid JSON parsing for every verdict', () => {
      it('parses a valid no_meaningful_change verdict', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 });
      });

      it('parses a valid meaning_added verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'Adds detail.', confidence: 0.8 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_added', dimensions: [], description: 'Adds detail.', confidence: 0.8 });
      });

      it('parses a valid meaning_removed verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_removed', dimensions: [], description: 'Removes nuance.', confidence: 0.7 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_removed', dimensions: [], description: 'Removes nuance.', confidence: 0.7 });
      });

      it('parses a valid meaning_transformed verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_transformed', dimensions: [], description: 'Shifts scope.', confidence: 0.6 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_transformed', dimensions: [], description: 'Shifts scope.', confidence: 0.6 });
      });

      it('parses a valid uncertain verdict', () => {
        const json = JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 0.5 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'uncertain', dimensions: [], description: null, confidence: 0.5 });
      });
    });

    describe('dimensions (Test 1 / v3 addendum, docs/decisions/0017)', () => {
      it('parses a no_meaningful_change verdict with a non-empty dimensions array', () => {
        const json = JSON.stringify({
          verdict: 'no_meaningful_change',
          dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
          description: null,
          confidence: 0.8,
        });
        const result = parseUntrustedJudgmentText(json);
        expect(result.dimensions).toEqual([{ dimension: 'certainty', direction: 'decreased' }]);
      });

      it('parses a change verdict with multiple distinct dimensions', () => {
        const json = JSON.stringify({
          verdict: 'meaning_transformed',
          dimensions: [
            { dimension: 'certainty', direction: 'increased' },
            { dimension: 'commitment', direction: 'increased' },
          ],
          description: 'Certainty and commitment both increased.',
          confidence: 0.85,
        });
        const result = parseUntrustedJudgmentText(json);
        expect(result.dimensions).toHaveLength(2);
      });

      it('throws when dimensions is missing entirely', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws when dimensions is not an array', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: null, description: null, confidence: 0.9 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on an unrecognized dimension value', () => {
        const json = JSON.stringify({
          verdict: 'no_meaningful_change',
          dimensions: [{ dimension: 'mood', direction: 'increased' }],
          description: null,
          confidence: 0.5,
        });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on an unrecognized direction value', () => {
        const json = JSON.stringify({
          verdict: 'no_meaningful_change',
          dimensions: [{ dimension: 'certainty', direction: 'sideways' }],
          description: null,
          confidence: 0.5,
        });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on a duplicate dimension within one judgment', () => {
        const json = JSON.stringify({
          verdict: 'meaning_transformed',
          dimensions: [
            { dimension: 'certainty', direction: 'increased' },
            { dimension: 'certainty', direction: 'decreased' },
          ],
          description: 'x',
          confidence: 0.5,
        });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws when uncertain has a non-empty dimensions array (kept simple for this first Test 1 pass)', () => {
        const json = JSON.stringify({
          verdict: 'uncertain',
          dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
          description: null,
          confidence: 0.3,
        });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });
    });

    describe('whitespace and formatting tolerance', () => {
      it('tolerates leading whitespace', () => {
        const json = `   ${JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 })}`;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });

      it('tolerates trailing whitespace', () => {
        const json = `${JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 })}   `;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });

      it('tolerates both leading and trailing whitespace', () => {
        const json = `\n\n  ${JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 0.5 })}  \n`;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('meaning_added');
      });
    });

    describe('Markdown fence tolerance', () => {
      it('tolerates a single surrounding ```json fence', () => {
        const raw = JSON.stringify({ verdict: 'meaning_removed', dimensions: [], description: 'x', confidence: 0.5 });
        const fenced = `\`\`\`json\n${raw}\n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('meaning_removed');
      });

      it('tolerates a Markdown fence without the json language specifier', () => {
        const raw = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 0.5 });
        const fenced = `\`\`\`\n${raw}\n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('meaning_added');
      });

      it('tolerates whitespace inside the fence', () => {
        const raw = JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 0.3 });
        const fenced = `\`\`\`json\n  ${raw}  \n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('uncertain');
      });
    });

    describe('trailing <|im_end|> Qwen transport token stripping', () => {
      it('strips a plain valid JSON payload followed by <|im_end|>', () => {
        const raw = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.0 });
        const result = parseUntrustedJudgmentText(`${raw}<|im_end|>`);
        expect(result).toEqual({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.0 });
      });

      it('strips <|im_end|> with whitespace between the JSON and the token', () => {
        const raw = JSON.stringify({ verdict: 'meaning_transformed', dimensions: [{ dimension: 'certainty', direction: 'increased' }], description: 'x', confidence: 0.7 });
        const result = parseUntrustedJudgmentText(`${raw}\n<|im_end|>\n`);
        expect(result.verdict).toBe('meaning_transformed');
      });

      it('strips a Markdown-fenced JSON payload followed by <|im_end|>', () => {
        const raw = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.0 });
        const fenced = `\`\`\`json\n${raw}\n\`\`\`<|im_end|>`;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result).toEqual({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.0 });
      });

      it('strips a <think> block, then a fenced JSON payload, then a trailing <|im_end|>', () => {
        const raw = JSON.stringify({ verdict: 'meaning_added', dimensions: [{ dimension: 'commitment', direction: 'increased' }], description: 'x', confidence: 0.8 });
        const combined = `<think>reasoning</think>\n\`\`\`json\n${raw}\n\`\`\`<|im_end|>`;
        const result = parseUntrustedJudgmentText(combined);
        expect(result.verdict).toBe('meaning_added');
        expect(result.dimensions).toEqual([{ dimension: 'commitment', direction: 'increased' }]);
      });

      it('prose + JSON + trailing <|im_end|> must still fail — stripping the token never extracts JSON out of surrounding prose', () => {
        const raw = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 0.5 });
        const withProse = `Sure, here you go: ${raw}<|im_end|>`;
        expect(() => parseUntrustedJudgmentText(withProse)).toThrow(/not valid JSON/);
      });

      it('still rejects malformed JSON even with a trailing <|im_end|> token', () => {
        expect(() => parseUntrustedJudgmentText('{verdict: no_meaningful_change}<|im_end|>')).toThrow(/not valid JSON/);
      });
    });

    describe('<think> block stripping', () => {
      it('strips a well-formed <think>...</think> block and does not persist it', () => {
        const json = JSON.stringify({ verdict: 'meaning_transformed', dimensions: [], description: 'x', confidence: 0.5 });
        const withThink = `<think>reasoning about the revision</think>${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result).toEqual({ verdict: 'meaning_transformed', dimensions: [], description: 'x', confidence: 0.5 });
        expect(JSON.stringify(result)).not.toContain('reasoning');
      });

      it('strips a <think> block with newlines and whitespace inside', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 });
        const withThink = `<think>\n  reasoning at length\n  with multiple lines\n</think>${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result.verdict).toBe('no_meaningful_change');
        expect(JSON.stringify(result)).not.toContain('reasoning');
      });

      it('handles a <think> block followed by whitespace before JSON', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 0.5 });
        const withThink = `<think>reasoning</think>\n\n${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result.verdict).toBe('meaning_added');
      });

      it('strips only a single leading <think> block, not multiple or nested ones', () => {
        const json = JSON.stringify({ verdict: 'meaning_removed', dimensions: [], description: 'x', confidence: 0.5 });
        const withThink = `<think>first</think>${json}<think>second</think>`;
        // The second think block will be in the string that fails to parse as JSON
        // So this should throw an error
        expect(() => parseUntrustedJudgmentText(withThink)).toThrow();
      });
    });

    describe('error handling — malformed/invalid responses', () => {
      it('throws with "not valid JSON" when content is not JSON', () => {
        expect(() => parseUntrustedJudgmentText('The revision seems to change meaning.')).toThrow(/not valid JSON/);
      });

      it('throws with "not valid JSON" on invalid JSON syntax', () => {
        expect(() => parseUntrustedJudgmentText('{verdict: no_meaningful_change}')).toThrow(/not valid JSON/);
      });

      it('throws with "expected semantic revision judgment schema" on unrecognized verdict', () => {
        const json = JSON.stringify({ verdict: 'trait_inferred', dimensions: [], description: 'x', confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" on non-numeric confidence', () => {
        const json = JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 'high' });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" when description is wrong-typed (not string, not null)', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 42, confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" when description is an empty array', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: [], confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing verdict field', () => {
        const json = JSON.stringify({ dimensions: [], description: 'x', confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing confidence field', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x' });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing description field', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws when the JSON object is wrapped in prose (not exactly one JSON object)', () => {
        const json = `Sure, here is my answer: ${JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'x', confidence: 0.5 })}`;
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/not valid JSON/);
      });
    });

    describe('edge cases', () => {
      it('accepts a confidence of 0', () => {
        const json = JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 0 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.confidence).toBe(0);
      });

      it('accepts a confidence of 1', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 1 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.confidence).toBe(1);
      });

      it('accepts a description of an empty string when verdict is not no_meaningful_change/uncertain', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: '', confidence: 0.5 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.description).toBe('');
      });

      it('accepts extra properties in the JSON (does not require exact key set)', () => {
        const json = JSON.stringify({
          verdict: 'no_meaningful_change',
          dimensions: [],
          description: null,
          confidence: 0.9,
          reasoning: 'extra field',
        });
        // This tests whether extra properties cause a validation error
        // Based on the code, it should accept it (isValidJudgmentWireShape checks the required keys but doesn't forbid others)
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });
    });
  });
});
