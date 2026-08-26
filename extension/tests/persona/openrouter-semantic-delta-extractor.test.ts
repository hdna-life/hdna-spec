import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterSemanticDeltaExtractor } from '../../src/persona/openrouter-semantic-delta-extractor';
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
        context: 'product_development',
        confidence: 0.6,
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
});
