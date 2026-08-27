import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekSemanticRevisionJudge } from '../../src/persona/deepseek-semantic-revision-judge';
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

describe('DeepSeekSemanticRevisionJudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request construction', () => {
    it('POSTs to https://api.deepseek.com/chat/completions', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

      await judge.judge(input);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.deepseek.com/chat/completions');
    });

    it('sends an Authorization header with Bearer token', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer sk-deepseek-test');
    });

    it('sends the exact configured model id, never a hardcoded/stronger fallback', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.model).toBe('deepseek-v4-flash');
      expect(body.model).not.toContain('gpt-4');
      expect(body.model).not.toContain('deepseek-r1');
    });

    it('sends response_format: { type: "json_object" } as a hint (not strict guarantee)', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

      await judge.judge(input);

      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('instructs the model in-prompt to return exactly one JSON object with the three expected keys', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

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
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash');
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'no_meaningful_change' });
    });
  });

  describe('valid judgment parsing', () => {
    it('parses a valid no_meaningful_change response', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.95 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toEqual({
        verdict: 'no_meaningful_change',
        description: null,
        confidence: 0.95,
      });
    });

    it('parses a valid meaning_added response', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'meaning_added', description: 'Adds a constraint.', confidence: 0.7 }),
      );
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_added' });
    });

    it('parses a valid meaning_removed response', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'meaning_removed', description: 'Removes a qualifier.', confidence: 0.6 }),
      );
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_removed' });
    });

    it('parses a valid meaning_transformed response', async () => {
      const fetchImpl = fakeFetchReturning(
        JSON.stringify({ verdict: 'meaning_transformed', description: 'Shifted specificity.', confidence: 0.8 }),
      );
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_transformed' });
    });

    it('parses a valid uncertain response', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'uncertain', description: null, confidence: 0.3 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'uncertain' });
    });

    it('tolerates surrounding whitespace around the JSON', async () => {
      const fetchImpl = fakeFetchReturning(
        `\n\n  ${JSON.stringify({ verdict: 'meaning_added', description: 'x', confidence: 0.5 })}  \n`,
      );
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_added' });
    });

    it('tolerates a single surrounding ```json Markdown fence', async () => {
      const raw = JSON.stringify({ verdict: 'meaning_removed', description: 'x', confidence: 0.5 });
      const fetchImpl = fakeFetchReturning('```json\n' + raw + '\n```');
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).resolves.toMatchObject({ verdict: 'meaning_removed' });
    });

    it('strips a well-formed <think>...</think> block before parsing, and does not persist/return it', async () => {
      const raw = JSON.stringify({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
      const fetchImpl = fakeFetchReturning(`<think>reasoning about the revision at length</think>${raw}`);
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      const result = await judge.judge(input);
      expect(result).toEqual({ verdict: 'meaning_transformed', description: 'x', confidence: 0.5 });
      expect(JSON.stringify(result)).not.toContain('reasoning about the revision');
    });
  });

  describe('untrusted-output discipline — malformed/invalid responses are rejected', () => {
    it('throws when response content is not valid JSON', async () => {
      const fetchImpl = fakeFetchReturning('The revision seems to change meaning slightly.');
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/not valid JSON/);
    });

    it('throws on an unrecognized verdict value', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'trait_inferred', description: 'x', confidence: 0.5 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws on an invalid (non-numeric) confidence rather than inventing one', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'uncertain', description: null, confidence: 'high' }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws when description is wrong-typed (not string, not null)', async () => {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'meaning_added', description: 42, confidence: 0.5 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/expected semantic revision judgment schema/);
    });

    it('throws when the message content is missing entirely', async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: {} }] }),
      })) as unknown as typeof fetch;
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/missing message content/);
    });

    it('throws when the message content is an empty string', async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      })) as unknown as typeof fetch;
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await expect(judge.judge(input)).rejects.toThrow(/missing message content/);
    });
  });

  describe('HTTP error handling', () => {
    it('throws on a non-ok HTTP response with status and statusText', async () => {
      const fetchImpl = fakeFetchReturning('', false, 401);
      const judge = new DeepSeekSemanticRevisionJudge('bad-key', 'deepseek-v4-flash', fetchImpl);

      await expect(judge.judge(input)).rejects.toThrow(/DeepSeek request failed: 401 Error/);
    });

    it('throws a plain Error (not a custom error class) for non-ok responses', async () => {
      const fetchImpl = fakeFetchReturning('', false, 500);
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);

      let caught: unknown;
      try {
        await judge.judge(input);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
    });
  });

  describe('provider identity', () => {
    it('providerId is deepseek/<shared Trial 3 version>, distinct from other transports', () => {
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash');
      expect(judge.providerId).toBe(`deepseek/${SEMANTIC_REVISION_JUDGE_VERSION}`);
      expect(judge.providerId).toBe('deepseek/deterministic-semantic-judge-v3');
      expect(judge.providerId).not.toBe('local-mlx/deterministic-semantic-judge-v3');
      expect(judge.providerId).not.toBe('openrouter/deterministic-semantic-judge-v3');
    });

    it('modelId is exactly what was passed in', () => {
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash');
      expect(judge.modelId).toBe('deepseek-v4-flash');
    });
  });

  describe('prompt contract — narrow, language-general', () => {
    async function capturedPromptContent(): Promise<string> {
      const fetchImpl = fakeFetchReturning(JSON.stringify({ verdict: 'no_meaningful_change', description: null, confidence: 0.9 }));
      const judge = new DeepSeekSemanticRevisionJudge('sk-deepseek-test', 'deepseek-v4-flash', fetchImpl);
      await judge.judge(input);
      const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      return body.messages[0].content as string;
    }

    it('is short: not enlarged to compensate for a larger model', async () => {
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

    it('includes only the one intervention\'s spans/context, not any notion of a whole EditEvent', async () => {
      const prompt = await capturedPromptContent();
      expect(prompt).toContain(input.originalText);
      expect(prompt).toContain(input.finalText);
      expect(prompt).toContain(input.beforeContext);
      expect(prompt).toContain(input.afterContext);
      expect(prompt).not.toMatch(/Original AI draft/i);
      expect(prompt).not.toMatch(/Human final text/i);
    });
  });
});
