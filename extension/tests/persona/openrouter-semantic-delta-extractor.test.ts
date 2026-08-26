import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterSemanticDeltaExtractor,
  EXTRACTION_PROMPT_VERSION,
} from '../../src/persona/openrouter-semantic-delta-extractor';
import type { SemanticDeltaExtractionInput } from '@spec/protocol/semantic-delta-extractor';

const input: SemanticDeltaExtractionInput = {
  originalText: 'Maybe add several more features before launching so the product feels more complete.',
  finalText:
    'Once bir MVP cikart. Ana fikri kanitlamadan ozellik eklemenin mantigi yok.',
  context: 'product_development',
};

function fakeFetchReturning(content: string, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

/** Mirrors the real MV3 native-fetch brand check — see openrouter-persona-interpreter.test.ts. */
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

describe('OpenRouterSemanticDeltaExtractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw "Illegal invocation" when using the default fetch binding', async () => {
    const globalFetch = installBrandCheckedGlobalFetch(JSON.stringify({ candidates: [] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini');

    await expect(extractor.extract(input)).resolves.toEqual([]);
    expect(globalFetch.calls).toBe(1);
  });

  it('requests the OpenRouter chat completions endpoint with the configured model, auth header, and structured-output schema', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await extractor.extract(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.response_format.type).toBe('json_schema');
  });

  it('lists every candidate property in the JSON Schema required array — strict OpenAI/Azure-compatible structured outputs reject a property that is absent from `required`', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await extractor.extract(input);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    const itemSchema = body.response_format.json_schema.schema.properties.candidates.items;
    expect(itemSchema.required.sort()).toEqual(
      ['kind', 'observation', 'preferred', 'rejected', 'context', 'confidence'].sort(),
    );
    expect(itemSchema.properties.preferred.type).toEqual(['string', 'null']);
    expect(itemSchema.properties.rejected.type).toEqual(['string', 'null']);
  });

  it('sends the raw original/final text in the outbound payload — Phase 5A intentionally does NOT minimize, unlike T3', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await extractor.extract(input);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(JSON.stringify(body)).toContain(input.originalText);
    expect(JSON.stringify(body)).toContain(input.finalText);
  });

  it('parses a valid structured response into candidate drafts', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({
        candidates: [
          {
            kind: 'behavioral_delta',
            observation: 'adds an explicit recommendation to validate before expanding scope',
            preferred: null,
            rejected: null,
            context: 'product_development',
            confidence: 0.6,
          },
        ],
      }),
    );
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    const drafts = await extractor.extract(input);
    expect(drafts).toEqual([
      {
        kind: 'behavioral_delta',
        observation: 'adds an explicit recommendation to validate before expanding scope',
        preferred: undefined,
        rejected: undefined,
        context: 'product_development',
        confidence: 0.6,
      },
    ]);
  });

  it('normalizes a real OpenAI/Azure-compatible strict-schema response — null preferred/rejected on a behavioral_delta candidate — to the domain optional-field representation (the exact shape that triggered the real HTTP 400 dogfood failure before this fix)', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({
        candidates: [
          {
            kind: 'behavioral_delta',
            observation: 'Removed explanatory framing while retaining the core recommendation.',
            preferred: null,
            rejected: null,
            context: 'unscoped',
            confidence: 0.9,
          },
        ],
      }),
    );
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    const drafts = await extractor.extract(input);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe('behavioral_delta');
    expect(drafts[0].preferred).toBeUndefined();
    expect(drafts[0].rejected).toBeUndefined();
    expect('preferred' in drafts[0] ? drafts[0].preferred === undefined : true).toBe(true);
  });

  it('accepts a contrastive_preference candidate with real string preferred/rejected values (not null)', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({
        candidates: [
          {
            kind: 'contrastive_preference',
            observation: 'kept the validate-before-expanding recommendation over adding more features',
            preferred: 'validate the core product hypothesis before expanding scope',
            rejected: 'additional product development before validating demand',
            context: 'product_development',
            confidence: 0.85,
          },
        ],
      }),
    );
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    const drafts = await extractor.extract(input);
    expect(drafts).toEqual([
      {
        kind: 'contrastive_preference',
        observation: 'kept the validate-before-expanding recommendation over adding more features',
        preferred: 'validate the core product hypothesis before expanding scope',
        rejected: 'additional product development before validating demand',
        context: 'product_development',
        confidence: 0.85,
      },
    ]);
  });

  it('supports abstention: an empty candidates array is a valid, successful response', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await expect(extractor.extract(input)).resolves.toEqual([]);
  });

  it('throws on a non-ok HTTP response', async () => {
    const fetchImpl = fakeFetchReturning('', false, 401);
    const extractor = new OpenRouterSemanticDeltaExtractor('bad-key', 'openai/gpt-4o-mini', fetchImpl);

    await expect(extractor.extract(input)).rejects.toThrow(/401/);
  });

  it('throws when response content is not valid JSON', async () => {
    const fetchImpl = fakeFetchReturning('not json');
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await expect(extractor.extract(input)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the parsed JSON does not match the expected candidates schema', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [{ kind: 'not_a_real_kind' }] }));
    const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await expect(extractor.extract(input)).rejects.toThrow(/expected candidates schema/);
  });

  describe('Trial 1: transformation-grounding instruction contract (docs/decisions/0016 Trial 1)', () => {
    /**
     * Asserts on the actual outbound prompt text sent to OpenRouter — the
     * real, load-bearing artifact, not a copy of it — rather than testing
     * an external LLM's semantic reasoning (which is not deterministic and
     * not something this suite can meaningfully unit-test). These checks
     * are generic prompt-contract assertions, not tests over any of the 5
     * real corpus EditEvents, and contain no language-specific content.
     */
    async function capturedPromptContent(): Promise<string> {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ candidates: [] }));
      const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);
      await extractor.extract(input);
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      return body.messages[0].content as string;
    }

    it('states that preserved meaning is not new evidence', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/PRESERVED meaning[\s\S]*?NOT new evidence/);
    });

    it('states that added meaning may be evidence', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain('ADDED');
      expect(prompt).toMatch(/ADDED, REMOVED, or materially TRANSFORMED[\s\S]*?may become a candidate/);
    });

    it('states that removed meaning may be evidence', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain('REMOVED');
    });

    it('states that materially transformed meaning may be evidence', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain('TRANSFORMED');
    });

    it('includes the mandatory ORIGINAL-only counterfactual check', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/MANDATORY CHECK/);
      expect(prompt).toMatch(/only ever seen the ORIGINAL AI draft, and never saw the human.s final text/);
      expect(prompt).toMatch(/do NOT emit it/);
    });

    it('states that paraphrase/textual-diff magnitude alone is not sufficient evidence of semantic change', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/not proof of semantic difference/);
      expect(prompt).toMatch(/edit distance, word-count difference, or the presence of paraphrasing/);
    });

    it('states that a small textual change may still represent a large semantic change', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/small wording change can express a large change in meaning/);
    });

    it('still prohibits stable personality/psychological inference from a single edit', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/Do not infer stable personality, psychology, motivation/);
    });

    it('still documents abstention (an empty candidates array) as valid', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/Abstain when no meaningful/);
      expect(prompt).toMatch(/empty candidates array/);
    });

    it('contains no hardcoded language-specific rule (no named language, no enumerated word/suffix list)', async () => {
      const prompt = await capturedPromptContent();
      // Guards against reintroducing e.g. a Turkish suffix list or an
      // English modal-word list into the instruction text itself — the
      // instruction may *warn against* relying on such things (that
      // sentence itself is not a language-specific rule), but must never
      // name a specific language or enumerate language-specific forms.
      expect(prompt.toLowerCase()).not.toContain('turkish');
      expect(prompt.toLowerCase()).not.toContain('english');
      expect(prompt).not.toMatch(/\bmorpholog/i);
      expect(prompt).not.toMatch(/-m[ıi]ş|-d[ıi]r|would\/could\/should|regex/i);
      expect(prompt).toMatch(/regardless of language/);
    });

    it('does not turn the illustrative semantic-property list into a closed taxonomy requirement', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/illustrative, not\s*\n?\s*exhaustive/);
    });

    it('bumps the extractor identity (providerId) relative to a bare "openrouter" so Trial 1 is distinguishable from the baseline extractor for receipt/idempotency purposes', () => {
      const extractor = new OpenRouterSemanticDeltaExtractor('sk-or-test', 'openai/gpt-4o-mini');
      expect(extractor.providerId).toBe(`openrouter/${EXTRACTION_PROMPT_VERSION}`);
      expect(extractor.providerId).not.toBe('openrouter');
      // modelId itself — the literal value sent to OpenRouter's `model`
      // field — must remain untouched by the prompt-version bump; only
      // providerId (extractorId) carries the versioning signal.
      expect(extractor.modelId).toBe('openai/gpt-4o-mini');
    });
  });
});
