import type {
  SemanticRevisionJudgeInput,
  SemanticRevisionJudgeProvider,
  SemanticRevisionJudgmentDraft,
} from '@spec/protocol/semantic-revision-judge';
import { SEMANTIC_REVISION_JUDGE_VERSION } from './semantic-revision-judge-identity';
import { buildNarrowJudgePrompt, parseUntrustedJudgmentText } from './semantic-revision-judge-wire';

/**
 * Trial 4's frontier benchmark-reference provider (docs/decisions/0017) —
 * used ONLY as one of three anonymized systems in the Trial 4 blind
 * benchmark (`Trial4BenchmarkService`), never as a training-data ground-
 * truth authority (Operator Decision 5, docs/decisions/0017: "DeepSeek
 * represents a useful frontier reference/ceiling. It does not determine
 * whether the trained Qwen answer is correct."). This class has no
 * involvement in Trial 4's training-data generation path at all — that is
 * a separate, external script (`training/phase5a/`) that calls DeepSeek
 * for candidate *stimulus* generation, not this provider.
 *
 * Verified against DeepSeek's own published API docs
 * (api-docs.deepseek.com), not assumed:
 * - Base URL `https://api.deepseek.com`, chat completions at
 *   `/chat/completions` (no `/v1` path segment, unlike OpenRouter/
 *   OpenAI-compatible-by-convention APIs — verified from DeepSeek's own
 *   docs, not inferred from the OpenAI convention).
 * - OpenAI/Anthropic-compatible request/response envelope
 *   (`{ model, messages }` in; `choices[0].message.content` out) — same
 *   shape every other `SemanticRevisionJudgeProvider` in this codebase
 *   already parses.
 * - Standard `Authorization: Bearer <apiKey>` auth.
 * - Supports `response_format: { type: 'json_object' }` ("JSON mode"),
 *   but DeepSeek's own docs describe this as prompt-engineering-assisted
 *   JSON mode, NOT strict JSON-Schema enforcement, and note the response
 *   can occasionally come back empty. This class therefore sends the hint
 *   (cheap, and DeepSeek's docs require the word "json" appear in the
 *   prompt for it to take effect — the shared narrow judge prompt already
 *   says "JSON object") but does NOT trust it: the response is parsed and
 *   validated by the exact same untrusted-output discipline as
 *   `LocalMlxSemanticRevisionJudge` (`semantic-revision-judge-wire.ts`),
 *   never assumed well-formed just because a hint was sent.
 *
 * Model id is caller-configured (`Trial4BenchmarkConfigStore`), never
 * defaulted or overridden by this class — see docs/decisions/0017 for
 * which model id the operator actually configures for a given benchmark
 * run.
 */
export class DeepSeekSemanticRevisionJudge implements SemanticRevisionJudgeProvider {
  readonly providerId = `deepseek/${SEMANTIC_REVISION_JUDGE_VERSION}`;

  constructor(
    private apiKey: string,
    readonly modelId: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async judge(input: SemanticRevisionJudgeInput): Promise<SemanticRevisionJudgmentDraft> {
    const response = await this.fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [{ role: 'user', content: buildNarrowJudgePrompt(input) }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      // DeepSeek's own docs note the API "may occasionally return empty
      // content" under JSON mode — treated as a judge failure, not
      // repaired/retried here (Trial 3 §10-11's discipline: reject rather
      // than guess). A caller wanting a retry policy implements it above
      // this provider, not inside it.
      throw new Error('DeepSeek response missing message content');
    }

    return parseUntrustedJudgmentText(content);
  }
}
