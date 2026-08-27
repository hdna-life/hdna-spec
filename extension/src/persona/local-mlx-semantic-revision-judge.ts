import type {
  SemanticRevisionJudgeInput,
  SemanticRevisionJudgeProvider,
  SemanticRevisionJudgmentDraft,
} from '@spec/protocol/semantic-revision-judge';
import { SEMANTIC_REVISION_JUDGE_VERSION } from './semantic-revision-judge-identity';

/**
 * Thrown when the local MLX-LM server could not be reached at all (the
 * `fetchImpl` call itself rejected — connection refused, DNS failure,
 * timeout — or the server responded with a non-2xx HTTP status, meaning it
 * did not produce a usable completion). Distinguished from a generic parse
 * failure so the operator/UI can tell "the server isn't running" apart
 * from "the server ran but Qwen3-0.6B's output didn't parse" — Trial 3
 * §12's LOCAL MODEL UNREACHABLE vs. LOCAL MODEL MALFORMED RESPONSE
 * distinction. `SemanticRevisionJudgeExtractionService` still treats both
 * uniformly as an isolated per-intervention judge failure
 * (`stats.judgeFailures`) — this class only makes the *message* attributable,
 * it does not change control flow.
 */
export class LocalMlxUnreachableError extends Error {}

/**
 * Verified against the actually-installed `mlx-lm==0.29.1` server
 * (`python3 -m mlx_lm.server --help` / `server.py` source, read directly —
 * not assumed) — see docs/decisions/0016's Trial 3 "local MLX transport"
 * addendum for the full verification record. Load-bearing facts this
 * provider depends on:
 *
 * - Endpoint: `POST {baseUrl}/v1/chat/completions`, OpenAI-compatible
 *   request/response shape (`{ model, messages }` in;
 *   `choices[0].message.content` out) — the same envelope shape
 *   `openrouter-semantic-revision-judge.ts` already parses, reused as-is.
 * - **No `response_format`/JSON-Schema/structured-output support at all**
 *   in this server version — `server.py`'s request-body parsing never
 *   reads a `response_format` key, so sending one is silently ignored, not
 *   honored. This provider therefore does NOT send `response_format`, and
 *   instead instructs the model in-prompt to return exactly one JSON
 *   object, then validates the parsed result deterministically — the
 *   model's output is untrusted regardless of what the prompt asked for
 *   (Trial 3 §10).
 * - **No authentication of any kind** — `do_POST`/`APIHandler` never reads
 *   an `Authorization` header or any API-key concept. This provider never
 *   sends one; the user's OpenRouter API key from Trial 0-2/the old
 *   OpenRouter Trial 3 attempt is never exposed to localhost (a
 *   structurally separate config store — see
 *   `semantic-revision-judge-config-store.ts` — never even holds it).
 * - Qwen3's "thinking" behavior is controlled by a **server-startup** flag
 *   (`mlx_lm.server --chat-template-args '{"enable_thinking": false}'`),
 *   not a per-request field — there is no request-body knob for it in this
 *   server version. The operator is expected to start the server with that
 *   flag (see docs/decisions/0016's Trial 3 operator command); this
 *   provider does not and cannot pass it per-request. As defense in depth
 *   (in case the operator starts the server without that flag, or a future
 *   MLX-LM version behaves differently), `stripThinkingBlock()` below
 *   strips one well-formed `<think>...</think>` block, if present, before
 *   attempting to parse JSON — a narrow, non-fragile normalization (Trial
 *   3 §11: "harmless transport formatting only"), not an attempt to
 *   interpret or repair the model's reasoning. The stripped block itself
 *   is never persisted, logged, or returned to the caller.
 */
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/i;
const MARKDOWN_JSON_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** Strips one leading `<think>...</think>` reasoning block, if present. Never persisted/logged — see this file's top-level docstring. */
function stripThinkingBlock(content: string): string {
  return content.replace(THINK_BLOCK_PATTERN, '').trim();
}

/** Strips a single surrounding Markdown code fence (```` ```json ... ``` ````), if the entire trimmed content is wrapped in exactly one. Does not attempt to recover a fence embedded in surrounding prose. */
function stripMarkdownFence(content: string): string {
  const match = content.match(MARKDOWN_JSON_FENCE_PATTERN);
  return match ? match[1] : content;
}

const VALID_VERDICTS = new Set([
  'no_meaningful_change',
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'uncertain',
]);

/**
 * Structural validation only — identical acceptance criteria to
 * `openrouter-semantic-revision-judge.ts`'s `isValidJudgmentWireShape`.
 * Never repairs, guesses, or infers a missing/malformed field (Trial 3
 * §11): a response that fails this check is a judge failure, not
 * degraded evidence.
 */
function isValidJudgmentWireShape(value: unknown): value is SemanticRevisionJudgmentDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (typeof draft.verdict !== 'string' || !VALID_VERDICTS.has(draft.verdict)) return false;
  if (draft.description !== null && typeof draft.description !== 'string') return false;
  if (typeof draft.confidence !== 'number') return false;
  return true;
}

/**
 * Trial 3's narrow judge prompt (docs/decisions/0016's Trial 3 §8), sent
 * unchanged from the OpenRouter provider in spirit but restated here as a
 * plain literal (not shared code) since the two providers' wire contracts
 * differ (structured `response_format` vs. plain in-prompt JSON
 * instruction) — deliberately NOT made larger to compensate for
 * Qwen3-0.6B's smaller capacity (Trial 3 §8: "do not make the prompt
 * larger to compensate... we want to test the architecture, not hide
 * model weakness with a huge reasoning prompt").
 */
function buildPrompt(input: SemanticRevisionJudgeInput): string {
  return [
    'You are judging one localized human text revision.\n\n',
    `Operation: ${input.kind}\n`,
    `Context before: "${input.beforeContext}"\n`,
    `Original span: "${input.originalText}"\n`,
    `Final span: "${input.finalText}"\n`,
    `Context after: "${input.afterContext}"\n\n`,
    'Decide whether this revision changes meaning in a directly observable ',
    'way.\n\n',
    'Do not infer personality, motivation, psychology, identity, or stable ',
    'preferences. Do not discuss anything beyond this one localized ',
    'revision — no other part of the text, no aggregation, no repeated ',
    'patterns.\n\n',
    'A textual change may preserve meaning. If meaning is essentially ',
    'preserved, verdict is "no_meaningful_change" and description is ',
    'null.\n\n',
    'If meaning is added, removed, or transformed, verdict is ',
    '"meaning_added", "meaning_removed", or "meaning_transformed", and ',
    'description is one short sentence describing only that narrow ',
    'semantic change, grounded only in the original span, the final span, ',
    'and the given context.\n\n',
    'If unsure, verdict is "uncertain" and description is null.\n\n',
    'This applies regardless of language; reason about the underlying ',
    'meaning shift itself, not language-specific wording, suffixes, or ',
    'grammar.\n\n',
    'Respond with EXACTLY one JSON object and nothing else — no ',
    'explanation, no Markdown, no extra text before or after it. The JSON ',
    'object must have exactly these three keys:\n',
    '{"verdict": "<one of: no_meaningful_change, meaning_added, ',
    'meaning_removed, meaning_transformed, uncertain>", "description": ',
    '<string or null>, "confidence": <number between 0 and 1>}',
  ].join('');
}

/**
 * Concrete `SemanticRevisionJudgeProvider` backed by a local MLX-LM HTTP
 * server (docs/decisions/0016's Trial 3 "local MLX transport" addendum) —
 * the current real transport for Trial 3, replacing OpenRouter for the
 * primary run. `Trial 3 orchestration
 * (SemanticRevisionJudgeExtractionService) does not know or care that this
 * provider is local` — it implements the exact same
 * `SemanticRevisionJudgeProvider` interface as
 * `OpenRouterSemanticRevisionJudge`, so swapping providers is purely a
 * config/wiring change (`entrypoints/background.ts`), never a service or
 * admission-logic change.
 *
 * No API key, ever — `judge()` never sets an `Authorization` header,
 * matching the verified local server contract (no auth check anywhere in
 * `server.py`). No fallback to OpenRouter or any other model/transport
 * exists in this class or anywhere it is constructed.
 */
export class LocalMlxSemanticRevisionJudge implements SemanticRevisionJudgeProvider {
  readonly providerId = `local-mlx/${SEMANTIC_REVISION_JUDGE_VERSION}`;

  constructor(
    /** e.g. "http://127.0.0.1:8080" — no trailing slash assumed; this class appends the path itself. */
    private baseUrl: string,
    readonly modelId: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async judge(input: SemanticRevisionJudgeInput): Promise<SemanticRevisionJudgmentDraft> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelId,
          messages: [{ role: 'user', content: buildPrompt(input) }],
          temperature: 0,
        }),
      });
    } catch (err) {
      throw new LocalMlxUnreachableError(
        `Local MLX server unreachable at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new LocalMlxUnreachableError(
        `Local MLX server at ${this.baseUrl} returned an error: ${response.status} ${response.statusText}`,
      );
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Local MLX response missing message content');
    }

    const withoutThinking = stripThinkingBlock(content);
    const jsonText = stripMarkdownFence(withoutThinking);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('Local MLX response content is not valid JSON');
    }

    if (!isValidJudgmentWireShape(parsed)) {
      throw new Error('Local MLX response did not match the expected semantic revision judgment schema');
    }

    return parsed;
  }
}
