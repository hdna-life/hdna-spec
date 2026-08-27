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

    it('lists the three required keys: verdict, description, confidence', () => {
      const prompt = buildNarrowJudgePrompt(input);
      expect(prompt).toContain('"verdict"');
      expect(prompt).toContain('"description"');
      expect(prompt).toContain('"confidence"');
    });
  });

  describe('parseUntrustedJudgmentText', () => {
    describe('valid JSON parsing for every verdict', () => {
      it('parses a valid no_meaningful_change verdict', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 });
      });

      it('parses a valid meaning_added verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: 'Adds detail.', confidence: 0.8 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_added', description: 'Adds detail.', confidence: 0.8 });
      });

      it('parses a valid meaning_removed verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_removed', description: 'Removes nuance.', confidence: 0.7 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_removed', description: 'Removes nuance.', confidence: 0.7 });
      });

      it('parses a valid meaning_transformed verdict', () => {
        const json = JSON.stringify({ verdict: 'meaning_transformed', description: 'Shifts scope.', confidence: 0.6 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'meaning_transformed', description: 'Shifts scope.', confidence: 0.6 });
      });

      it('parses a valid uncertain verdict', () => {
        const json = JSON.stringify({ verdict: 'uncertain', description: null, confidence: 0.5 });
        const result = parseUntrustedJudgmentText(json);
        expect(result).toEqual({ verdict: 'uncertain', description: null, confidence: 0.5 });
      });
    });

    describe('whitespace and formatting tolerance', () => {
      it('tolerates leading whitespace', () => {
        const json = `   ${JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 })}`;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });

      it('tolerates trailing whitespace', () => {
        const json = `${JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 })}   `;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });

      it('tolerates both leading and trailing whitespace', () => {
        const json = `\n\n  ${JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 })}  \n`;
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('meaning_added');
      });
    });

    describe('Markdown fence tolerance', () => {
      it('tolerates a single surrounding ```json fence', () => {
        const raw = JSON.stringify({ verdict: 'meaning_removed', description: 'x', confidence: 0.5 });
        const fenced = `\`\`\`json\n${raw}\n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('meaning_removed');
      });

      it('tolerates a Markdown fence without the json language specifier', () => {
        const raw = JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 });
        const fenced = `\`\`\`\n${raw}\n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('meaning_added');
      });

      it('tolerates whitespace inside the fence', () => {
        const raw = JSON.stringify({ verdict: 'uncertain', description: null, confidence: 0.3 });
        const fenced = `\`\`\`json\n  ${raw}  \n\`\`\``;
        const result = parseUntrustedJudgmentText(fenced);
        expect(result.verdict).toBe('uncertain');
      });
    });

    describe('<think> block stripping', () => {
      it('strips a well-formed <think>...</think> block and does not persist it', () => {
        const json = JSON.stringify({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
        const withThink = `<think>reasoning about the revision</think>${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result).toEqual({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
        expect(JSON.stringify(result)).not.toContain('reasoning');
      });

      it('strips a <think> block with newlines and whitespace inside', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 });
        const withThink = `<think>\n  reasoning at length\n  with multiple lines\n</think>${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result.verdict).toBe('no_meaningful_change');
        expect(JSON.stringify(result)).not.toContain('reasoning');
      });

      it('handles a <think> block followed by whitespace before JSON', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 });
        const withThink = `<think>reasoning</think>\n\n${json}`;
        const result = parseUntrustedJudgmentText(withThink);
        expect(result.verdict).toBe('meaning_added');
      });

      it('strips only a single leading <think> block, not multiple or nested ones', () => {
        const json = JSON.stringify({ verdict: 'meaning_removed', description: 'x', confidence: 0.5 });
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
        const json = JSON.stringify({ verdict: 'trait_inferred', description: 'x', confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" on non-numeric confidence', () => {
        const json = JSON.stringify({ verdict: 'uncertain', description: null, confidence: 'high' });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" when description is wrong-typed (not string, not null)', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: 42, confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws with "expected semantic revision judgment schema" when description is an empty array', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: [], confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing verdict field', () => {
        const json = JSON.stringify({ description: 'x', confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing confidence field', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: 'x' });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws on missing description field', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', confidence: 0.5 });
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/expected semantic revision judgment schema/);
      });

      it('throws when the JSON object is wrapped in prose (not exactly one JSON object)', () => {
        const json = `Sure, here is my answer: ${JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 })}`;
        expect(() => parseUntrustedJudgmentText(json)).toThrow(/not valid JSON/);
      });
    });

    describe('edge cases', () => {
      it('accepts a confidence of 0', () => {
        const json = JSON.stringify({ verdict: 'uncertain', description: null, confidence: 0 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.confidence).toBe(0);
      });

      it('accepts a confidence of 1', () => {
        const json = JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 1 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.confidence).toBe(1);
      });

      it('accepts a description of an empty string when verdict is not no_meaningful_change/uncertain', () => {
        const json = JSON.stringify({ verdict: 'meaning_added', description: '', confidence: 0.5 });
        const result = parseUntrustedJudgmentText(json);
        expect(result.description).toBe('');
      });

      it('accepts extra properties in the JSON (does not require exact key set)', () => {
        const json = JSON.stringify({
          verdict: 'no_meaningful_change',
          description: null,
          confidence: 0.9,
          reasoning: 'extra field',
        });
        // This tests whether extra properties cause a validation error
        // Based on the code, it should accept it (isValidJudgmentWireShape checks the three keys but doesn't forbid others)
        const result = parseUntrustedJudgmentText(json);
        expect(result.verdict).toBe('no_meaningful_change');
      });
    });
  });
});
