import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMlxSemanticRevisionJudge } from '../../src/persona/local-mlx-semantic-revision-judge';
import { OpenRouterSemanticRevisionJudge } from '../../src/persona/openrouter-semantic-revision-judge';
import { BEHAVIOR_DIMENSIONS, BEHAVIOR_DIRECTIONS } from '../../src/persona/behavior-dimension';
import type { SemanticRevisionJudgeInput } from '@spec/protocol/semantic-revision-judge';

/**
 * Verifies Trial 4's fairness requirement (docs/decisions/0017, Test 1's
 * "isolate model weights" rule) at the prompt-construction level: Base and
 * Trained are both `LocalMlxSemanticRevisionJudge` instances (only the
 * `baseUrl` — i.e. which server/adapter answers — differs), so they call
 * the exact same `buildNarrowJudgePrompt` function; this test proves that
 * by capturing the literal prompt bytes each sends and asserting equality,
 * rather than trusting the "same class" argument alone. It also proves the
 * benchmark path (not just the wire-parser unit tests) carries the full
 * v3 four-key/two-axis contract, and that DeepSeek (via OpenRouter)
 * declares the same canonical dimension/direction/verdict values in its
 * structured-output schema — the three providers Trial4BenchmarkService
 * wires together for one benchmark case.
 */

const CASE_INPUT: SemanticRevisionJudgeInput = {
  kind: 'replaced',
  originalText: 'Maybe I will come tomorrow.',
  finalText: 'I will come tomorrow.',
  beforeContext: 'He said,',
  afterContext: 'to the meeting.',
};

function fakeLocalFetch(content: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

const VALID_LOCAL_RESPONSE = JSON.stringify({
  verdict: 'meaning_transformed',
  dimensions: [{ dimension: 'certainty', direction: 'increased' }],
  description: 'x',
  confidence: 0.8,
});

describe('Trial 4 benchmark prompt/contract fairness (Base vs. Trained vs. DeepSeek)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Base and Trained (same LocalMlxSemanticRevisionJudge class, different baseUrl only) send byte-identical prompts for the same case', async () => {
    const baseFetch = fakeLocalFetch(VALID_LOCAL_RESPONSE);
    const trainedFetch = fakeLocalFetch(VALID_LOCAL_RESPONSE);
    const base = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', baseFetch);
    const trained = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8081', 'Qwen/Qwen3-0.6B', trainedFetch);

    await base.judge(CASE_INPUT);
    await trained.judge(CASE_INPUT);

    const basePrompt = JSON.parse((baseFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body).messages[0].content;
    const trainedPrompt = JSON.parse((trainedFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body).messages[0].content;
    expect(basePrompt).toBe(trainedPrompt);
  });

  it('Base and Trained send the same temperature (0) and no provider-specific prompt hints', async () => {
    const baseFetch = fakeLocalFetch(VALID_LOCAL_RESPONSE);
    const trainedFetch = fakeLocalFetch(VALID_LOCAL_RESPONSE);
    const base = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', baseFetch);
    const trained = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8081', 'Qwen/Qwen3-0.6B', trainedFetch);

    await base.judge(CASE_INPUT);
    await trained.judge(CASE_INPUT);

    const baseBody = JSON.parse((baseFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const trainedBody = JSON.parse((trainedFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(baseBody.temperature).toBe(0);
    expect(trainedBody.temperature).toBe(0);
    expect(baseBody.messages).toEqual(trainedBody.messages);
  });

  it('local (Base/Trained) prompt carries the v3 two-axis, four-key contract — not the old Trial 3 three-key semantic-only shape', async () => {
    const fetchImpl = fakeLocalFetch(VALID_LOCAL_RESPONSE);
    const base = new LocalMlxSemanticRevisionJudge('http://127.0.0.1:8080', 'Qwen/Qwen3-0.6B', fetchImpl);
    await base.judge(CASE_INPUT);
    const prompt = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1].body).messages[0].content as string;

    expect(prompt).toMatch(/TWO SEPARATE questions/i);
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"dimensions"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toMatch(/exactly these four keys/i);
    // Old Trial 3 three-key wording must not remain anywhere in the path.
    expect(prompt).not.toMatch(/exactly these three keys/i);

    for (const dimension of BEHAVIOR_DIMENSIONS) expect(prompt).toContain(dimension);
    for (const direction of BEHAVIOR_DIRECTIONS) expect(prompt).toContain(direction);
  });

  it('DeepSeek (via OpenRouter) declares the same canonical v3 verdict/dimension/direction values and four output keys in its structured-output schema', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: VALID_LOCAL_RESPONSE } }] }),
    })) as unknown as typeof fetch;
    const deepseek = new OpenRouterSemanticRevisionJudge('sk-or-test', 'deepseek/deepseek-v4-flash-0731', fetchImpl);

    await deepseek.judge(CASE_INPUT);

    const body = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const schema = body.response_format.json_schema.schema;
    expect(Object.keys(schema.properties).sort()).toEqual(['confidence', 'description', 'dimensions', 'verdict']);
    expect(schema.properties.verdict.enum).toEqual([
      'no_meaningful_change',
      'meaning_added',
      'meaning_removed',
      'meaning_transformed',
      'uncertain',
    ]);
    const branches = schema.properties.dimensions.items.anyOf as Array<{
      properties: { dimension: { enum: string[] }; direction: { enum: string[] } };
    }>;
    expect(branches.map((b) => b.properties.dimension.enum[0])).toEqual(BEHAVIOR_DIMENSIONS);
    for (const branch of branches) {
      for (const direction of branch.properties.direction.enum) {
        expect(BEHAVIOR_DIRECTIONS).toContain(direction);
      }
    }

    // Same reasoning/task framing as the local prompt — the prose prompt
    // (also sent, as a user message, since OpenRouter's structured output
    // constrains the JSON shape but does not replace prompting the model
    // on the task itself) carries the same two-axis instructions.
    const promptContent = body.messages[0].content as string;
    expect(promptContent).toMatch(/TWO SEPARATE questions/i);
    expect(promptContent).toContain('OBSERVABLE BEHAVIORAL DIMENSIONS');
  });

  it('DeepSeek is reached only via https://openrouter.ai/api/v1/chat/completions — never a direct DeepSeek API endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: VALID_LOCAL_RESPONSE } }] }),
    })) as unknown as typeof fetch;
    const deepseek = new OpenRouterSemanticRevisionJudge('sk-or-test', 'deepseek/deepseek-v4-flash-0731', fetchImpl);

    await deepseek.judge(CASE_INPUT);

    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
