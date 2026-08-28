import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterSemanticRevisionJudge,
  SEMANTIC_REVISION_JUDGE_VERSION,
} from '../../src/persona/openrouter-semantic-revision-judge';
import type { SemanticRevisionJudgeInput } from '@spec/protocol/semantic-revision-judge';

const input: SemanticRevisionJudgeInput = {
  kind: 'replaced',
  originalText: 'broad framing',
  finalText: 'specific framing',
  beforeContext: 'A generic statement using',
  afterContext: 'to describe the plan.',
};

function fakeFetchReturning(content: string, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

/** Mirrors the real MV3 native-fetch brand check — see openrouter-semantic-delta-extractor.test.ts. */
function installBrandCheckedGlobalFetch(responseContent: string): { calls: number } {
  const state = { calls: 0 };
  function brandCheckedFetch(this: unknown) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    }
    state.calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: responseContent } }] }),
    });
  }
  vi.stubGlobal('fetch', brandCheckedFetch);
  return state;
}

describe('OpenRouterSemanticRevisionJudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw "Illegal invocation" when using the default fetch binding', async () => {
    const globalFetch = installBrandCheckedGlobalFetch(
      JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b');

    await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'no_meaningful_change' });
    expect(globalFetch.calls).toBe(1);
  });

  it('requests the OpenRouter chat completions endpoint with the configured model, auth header, and structured-output schema', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);

    await judge.judge(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen/qwen3-1.7b');
    expect(body.response_format.type).toBe('json_schema');
  });

  it('never silently substitutes a different/stronger model — the requested model is exactly modelId', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await judge.judge(input);
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen/qwen3-1.7b');
    expect(body.model).not.toContain('gpt-4o-mini');
    expect(body.model).not.toContain('gpt-4');
  });

  it('lists every judgment property in the JSON Schema required array under strict mode, description nullable', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);

    await judge.judge(input);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    const schema = body.response_format.json_schema.schema;
    expect(schema.required.sort()).toEqual(['verdict', 'dimensions', 'description', 'confidence'].sort());
    expect(schema.properties.description.type).toEqual(['string', 'null']);
  });

  describe('dimensions (Test 1 / v3 addendum, docs/decisions/0017)', () => {
    it('declares the dimensions array item schema with dimension/direction enums, both required, under strict mode', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await judge.judge(input);
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      const itemSchema = body.response_format.json_schema.schema.properties.dimensions.items;
      expect(itemSchema.required.sort()).toEqual(['dimension', 'direction'].sort());
      expect(itemSchema.additionalProperties).toBe(false);
      expect(itemSchema.properties.dimension.enum).toContain('certainty');
      expect(itemSchema.properties.direction.enum).toContain('increased');
    });

    it('parses a judgment with a non-empty dimensions array', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({
          verdict: 'no_meaningful_change',
          dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
          description: null,
          confidence: 0.8,
        }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({
        dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
      });
    });

    it('rejects a response with a duplicate dimension', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({
          verdict: 'meaning_transformed',
          dimensions: [
            { dimension: 'certainty', direction: 'increased' },
            { dimension: 'certainty', direction: 'decreased' },
          ],
          description: 'x',
          confidence: 0.5,
        }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('rejects a response where uncertain has a non-empty dimensions array', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({
          verdict: 'uncertain',
          dimensions: [{ dimension: 'certainty', direction: 'decreased' }],
          description: null,
          confidence: 0.3,
        }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('rejects a response missing the dimensions field entirely', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });
  });

  it('parses a valid no_meaningful_change response', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.95 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).resolves.toEqual({
      verdict: 'no_meaningful_change',
      dimensions: [],
      description: null,
      confidence: 0.95,
    });
  });

  it('parses a valid meaning_added response', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 'Adds a specific constraint.', confidence: 0.7 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).resolves.toEqual({
      verdict: 'meaning_added',
      dimensions: [],
      description: 'Adds a specific constraint.',
      confidence: 0.7,
    });
  });

  it('parses a valid meaning_removed response', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'meaning_removed', dimensions: [], description: 'Removes a hedge.', confidence: 0.6 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_removed' });
  });

  it('parses a valid meaning_transformed response', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'meaning_transformed', dimensions: [], description: 'Shifted specificity.', confidence: 0.8 }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_transformed' });
  });

  it('parses a valid uncertain response', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 0.3 }));
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'uncertain' });
  });

  it('throws on a non-ok HTTP response', async () => {
    const fetchImpl = fakeFetchReturning('', false, 401);
    const judge = new OpenRouterSemanticRevisionJudge('bad-key', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).rejects.toThrow(/401/);
  });

  it('throws when response content is not valid JSON', async () => {
    const fetchImpl = fakeFetchReturning('not json');
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the parsed JSON does not match the expected judgment schema (malformed output)', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'not_a_real_verdict' }));
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
  });

  it('throws when confidence is not a number (invalid confidence)', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({ verdict: 'uncertain', dimensions: [], description: null, confidence: 'high' }),
    );
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
  });

  it('throws when description is neither a string nor null (blank/wrong-typed description)', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'meaning_added', dimensions: [], description: 42, confidence: 0.5 }));
    const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
    await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
  });

  describe('provider identity', () => {
    it('providerId encodes SEMANTIC_REVISION_JUDGE_VERSION, distinct from Trial 0/1/2\'s openrouter/* identities', () => {
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b');
      expect(judge.providerId).toBe(`openrouter/${SEMANTIC_REVISION_JUDGE_VERSION}`);
      expect(judge.providerId).toBe('openrouter/deterministic-semantic-judge-v3');
      expect(judge.providerId).not.toBe('openrouter');
      expect(judge.providerId).not.toBe('openrouter/transformation-grounded-v1');
      expect(judge.providerId).not.toBe('openrouter/evidence-localized-v2');
    });

    it('modelId is exactly what was passed in, never a hardcoded default', () => {
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b');
      expect(judge.modelId).toBe('qwen/qwen3-1.7b');
    });
  });

  describe('prompt contract — narrow, one intervention at a time, language-general', () => {
    async function capturedPromptContent(promptInput: SemanticRevisionJudgeInput = input): Promise<string> {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'no_meaningful_change', dimensions: [], description: null, confidence: 0.9 }),
      );
      const judge = new OpenRouterSemanticRevisionJudge('sk-or-test', 'qwen/qwen3-1.7b', fetchImpl);
      await judge.judge(promptInput);
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      return body.messages[0].content as string;
    }

    it('includes only the one intervention\'s spans/context, not any notion of a whole EditEvent', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain(input.originalText);
      expect(prompt).toContain(input.finalText);
      expect(prompt).toContain(input.beforeContext);
      expect(prompt).toContain(input.afterContext);
      expect(prompt).not.toMatch(/Original AI draft/i);
      expect(prompt).not.toMatch(/Human final text/i);
    });

    it('prohibits inferring personality, motivation, psychology, identity, or stable preferences', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/personality/i);
      expect(prompt).toMatch(/motivation/i);
      expect(prompt).toMatch(/psycholog/i);
      expect(prompt).toMatch(/identity/i);
      expect(prompt).toMatch(/stable/i);
    });

    it('allows/instructs no_meaningful_change and uncertain as valid outcomes', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain('no_meaningful_change');
      expect(prompt).toContain('uncertain');
    });

    it('instructs the model not to discuss anything beyond the one localized revision', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/beyond this one localized revision/i);
    });

    it('is compact: well under the size of Trial 1/2\'s large reasoning prompt, even after adding the second (dimensions) axis', async () => {
      const prompt = await capturedPromptContent();
      // Raised from 2000 (Trial 3's original single-axis threshold) to 3500
      // when Test 1's second axis (dimensions) was added — a real,
      // necessary increase for a real second question, not "enlarging the
      // prompt to compensate for model weakness" (docs/decisions/0016's
      // Trial 3 §8 concern, which this bound still guards against relative
      // to Trial 1/2's several-thousand-character reasoning prompt).
      expect(prompt.length).toBeLessThan(3500);
    });

    it('contains no named language, morphology terminology, or enumerated language-specific forms (language-general requirement, Trial 3 §11)', async () => {
      const prompt = await capturedPromptContent();
      const forbidden = [/turkish/i, /\benglish\b/i, /auxiliary verb/i, /grammar table/i, /morpheme/i];
      for (const pattern of forbidden) {
        expect(prompt).not.toMatch(pattern);
      }
    });

    it('states the two axes as separate questions and lists the dimension/direction vocabulary (Test 1 addendum)', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/TWO SEPARATE questions/i);
      expect(prompt).toContain('certainty');
      expect(prompt).toContain('increased');
      expect(prompt).toMatch(/never infer the human.s actual internal emotion/i);
      expect(prompt).toMatch(/verdict is "uncertain", dimensions must be an empty array/i);
    });
  });
});
