import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterPersonaInterpreter } from '../../src/persona/openrouter-persona-interpreter';
import type { PatternCandidate } from '@spec/protocol/persona-interpreter';

const candidates: PatternCandidate[] = [
  { dimension: 'formality', context: 'unscoped', value: 0.5, sampleCount: 3 },
];

function fakeFetchReturning(content: string, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

/**
 * Mirrors the real browser/MV3-service-worker brand check on native
 * `fetch`: it throws "Illegal invocation" unless called with `globalThis`
 * (or the exact object it was captured from) as the receiver. A plain
 * `private fetchImpl: typeof fetch = fetch` default, later invoked as
 * `this.fetchImpl(...)`, calls it with the interpreter instance as the
 * receiver instead — reproducing the real bug found via manual dogfood.
 */
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

describe('OpenRouterPersonaInterpreter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw "Illegal invocation" when using the default fetch binding — regression for this.fetchImpl(...) calling fetch with the interpreter instance as receiver', async () => {
    const globalFetch = installBrandCheckedGlobalFetch(JSON.stringify({ claims: [] }));
    // No third constructor argument — exercises the default `fetchImpl`,
    // which is what a real background.ts-constructed provider actually
    // uses (see the provider factory in entrypoints/background.ts).
    const interpreter = new OpenRouterPersonaInterpreter('sk-or-test', 'openai/gpt-4o-mini');

    await expect(interpreter.interpret(candidates)).resolves.toEqual([]);
    expect(globalFetch.calls).toBe(1);
  });

  it('requests the OpenRouter chat completions endpoint with the configured model, auth header, and structured-output schema', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ claims: [] }));
    const interpreter = new OpenRouterPersonaInterpreter('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await interpreter.interpret(candidates);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.response_format.type).toBe('json_schema');
    // Only aggregate stats appear in the outbound payload — no raw evidence text.
    expect(JSON.stringify(body)).toContain('formality:unscoped');
    expect(JSON.stringify(body)).not.toContain('writing_sample');
  });

  it('parses a valid structured response into claim drafts', async () => {
    const fetchImpl = fakeFetchReturning(
      JSON.stringify({
        claims: [
          {
            claim: 'prioritizes implementation simplicity',
            context: 'unscoped',
            confidence: 0.6,
            supportingPatternKeys: ['formality:unscoped'],
          },
        ],
      }),
    );
    const interpreter = new OpenRouterPersonaInterpreter('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    const drafts = await interpreter.interpret(candidates);
    expect(drafts).toEqual([
      {
        claim: 'prioritizes implementation simplicity',
        context: 'unscoped',
        confidence: 0.6,
        supportingPatternKeys: ['formality:unscoped'],
      },
    ]);
  });

  it('throws on a non-ok HTTP response', async () => {
    const fetchImpl = fakeFetchReturning('', false, 401);
    const interpreter = new OpenRouterPersonaInterpreter('bad-key', 'openai/gpt-4o-mini', fetchImpl);

    await expect(interpreter.interpret(candidates)).rejects.toThrow(/401/);
  });

  it('throws when response content is not valid JSON', async () => {
    const fetchImpl = fakeFetchReturning('not json');
    const interpreter = new OpenRouterPersonaInterpreter('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await expect(interpreter.interpret(candidates)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the parsed JSON does not match the expected claims schema', async () => {
    const fetchImpl = fakeFetchReturning(JSON.stringify({ claims: [{ claim: 'missing fields' }] }));
    const interpreter = new OpenRouterPersonaInterpreter('sk-or-test', 'openai/gpt-4o-mini', fetchImpl);

    await expect(interpreter.interpret(candidates)).rejects.toThrow(/expected claims schema/);
  });
});
