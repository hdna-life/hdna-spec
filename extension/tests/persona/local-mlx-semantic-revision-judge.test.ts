import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalMlxSemanticRevisionJudge,
  LocalMlxUnreachableError,
} from '../../src/persona/local-mlx-semantic-revision-judge';
import { SEMANTIC_REVISION_JUDGE_VERSION } from '../../src/persona/semantic-revision-judge-identity';
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

describe('LocalMlxSemanticRevisionJudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request construction', () => {
    it('POSTs to {baseUrl}/v1/chat/completions', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await judge.judge(input);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    });

    it('sends the exact configured model id, never a hardcoded/stronger fallback', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.model).toBe('Qwen/Qwen3-0.6B');
      expect(body.model).not.toContain('gpt-4');
      expect(body.model).not.toContain('qwen3-1.7b');
    });

    it('sends no Authorization header at all — no API key exposed to localhost', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(init.headers).not.toHaveProperty('Authorization');
      expect(JSON.stringify(init.headers)).not.toMatch(/Bearer/);
    });

    it('does not send a response_format field — the verified local server contract does not support one', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).not.toHaveProperty('response_format');
    });

    it('instructs the model in-prompt to return exactly one JSON object with the three expected keys', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      const prompt = body.messages[0].content as string;
      expect(prompt).toContain('"verdict"');
      expect(prompt).toContain('"description"');
      expect(prompt).toContain('"confidence"');
    });

    it('uses the default fetch.bind(globalThis) binding when no fetchImpl is supplied', async () => {
      function brandCheckedFetch(this: unknown) {
        if (this !== globalThis) {
          throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }) } }],
          }),
        });
      }
      vi.stubGlobal('fetch', brandCheckedFetch);
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B');
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'no_meaningful_change' });
    });
  });

  describe('valid judgment parsing', () => {
    it('parses a valid no_meaningful_change response', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.95 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).resolves.toEqual({
        verdict: 'no_meaningful_change',
        description: null,
        confidence: 0.95,
      });
    });

    it('parses a valid meaning_transformed response', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'meaning_transformed', description: 'Shifted specificity.', confidence: 0.6 }),
      );
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_transformed' });
    });

    it('parses a valid uncertain response', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'uncertain', description: null, confidence: 0.3 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'uncertain' });
    });

    it('tolerates surrounding whitespace around the JSON', async () => {
      const fetchImpl = fakeFetchReturning(
        `\n\n  ${JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 })}  \n`,
      );
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_added' });
    });

    it('tolerates a single surrounding ```json Markdown fence', async () => {
      const raw = JSON.stringify({ verdict: 'meaning_removed', description: 'x', confidence: 0.5 });
      const fetchImpl = fakeFetchReturning('```json\n' + raw + '\n```');
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_removed' });
    });

    it('strips a well-formed <think>...</think> block before parsing, and does not persist/return it', async () => {
      const raw = JSON.stringify({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
      const fetchImpl = fakeFetchReturning(`<think>reasoning about the revision at length</think>${raw}`);
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      const result = await judge.judge(input);
      expect(result).toEqual({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
      expect(JSON.stringify(result)).not.toContain('reasoning about the revision');
    });
  });

  describe('untrusted-output discipline — malformed/invalid responses are rejected, never repaired', () => {
    it('throws when response content is not valid JSON (and does not invent a verdict)', async () => {
      const fetchImpl = fakeFetchReturning('The revision seems to change meaning slightly.');
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/not valid JSON/);
    });

    it('throws on an unrecognized verdict value', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'trait_inferred', description: 'x', confidence: 0.5 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws on an invalid (non-numeric) confidence rather than inventing one', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'uncertain', description: null, confidence: 'high' }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws when description is wrong-typed (not string, not null)', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'meaning_added', description: 42, confidence: 0.5 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws when the model returns prose plus JSON rather than exactly one JSON object (not silently extracted)', async () => {
      const fetchImpl = fakeFetchReturning(
        `Sure, here is my answer: ${JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 })}`,
      );
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/not valid JSON/);
    });

    it('throws when the message content is missing entirely', async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: {} }] }),
      })) as unknown as typeof fetch;
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/missing message content/);
    });
  });

  describe('local transport failure attribution', () => {
    it('throws LocalMlxUnreachableError, naming the baseUrl, when the fetch itself rejects (server not running)', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await expect(judge.judge(input)).rejects.toThrow(LocalMlxUnreachableError);
      await expect(judge.judge(input)).rejects.toThrow(/http:\/\/127\.0\.0\.1:8080/);
    });

    it('throws LocalMlxUnreachableError on a non-ok HTTP response', async () => {
      const fetchImpl = fakeFetchReturning('', false, 500);
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      await expect(judge.judge(input)).rejects.toThrow(LocalMlxUnreachableError);
      await expect(judge.judge(input)).rejects.toThrow(/500/);
    });

    it('a malformed-but-reachable response throws a plain Error, distinguishable from LocalMlxUnreachableError', async () => {
      const fetchImpl = fakeFetchReturning('not json at all');
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);

      let caught: unknown;
      try {
        await judge.judge(input);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(LocalMlxUnreachableError);
    });
  });

  describe('provider identity', () => {
    it('providerId is local-mlx/<shared Trial 3 version>, distinct from the OpenRouter transport', () => {
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B');
      expect(judge.providerId).toBe(`local-mlx/${SEMANTIC_REVISION_JUDGE_VERSION}`);
      expect(judge.providerId).toBe('local-mlx/deterministic-semantic-judge-v3');
      expect(judge.providerId).not.toBe('openrouter/deterministic-semantic-judge-v3');
    });

    it('modelId is exactly what was passed in', () => {
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B');
      expect(judge.modelId).toBe('Qwen/Qwen3-0.6B');
    });
  });

  describe('prompt contract — narrow, unchanged in spirit from the OpenRouter transport', () => {
    async function capturedPromptContent(): Promise<string> {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
      await judge.judge(input);
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      return body.messages[0].content as string;
    }

    it('is short: not enlarged to compensate for a smaller model', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt.length).toBeLessThan(2200);
    });

    it('prohibits inferring personality/motivation/psychology/identity/stable preferences', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toMatch(/personality/i);
      expect(prompt).toMatch(/motivation/i);
      expect(prompt).toMatch(/psycholog/i);
      expect(prompt).toMatch(/identity/i);
      expect(prompt).toMatch(/stable/i);
    });

    it('contains no named language or language-specific grammatical terminology', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).not.toMatch(/turkish/i);
      expect(prompt).not.toMatch(/\benglish\b/i);
      expect(prompt).not.toMatch(/morpheme/i);
    });
  });
});
