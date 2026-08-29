import type { SemanticRevisionJudgeInput, SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';
import { formatCanonicalDimensionDirections, isValidDimensionsArray } from './behavior-dimension';

/**
 * Shared "untrusted JSON wire protocol" for any `SemanticRevisionJudgeProvider`
 * transport that cannot rely on a provider-enforced structured-output
 * contract (`response_format`/JSON-Schema) — currently only
 * `LocalMlxSemanticRevisionJudge` (docs/decisions/0016's Trial 3 "local MLX
 * transport" addendum), used for Trial 4's `base`/`trained` roles. It asks
 * the model, in-prompt, to return exactly one JSON object, then runs the
 * defensive parse/validate here — extracted to this module so the
 * "untrusted output, no repair, reject on malformed" discipline (Trial
 * 3 §10-11) is defined and tested in one place.
 *
 * **Test 1 / v3 addendum (docs/decisions/0017):** the prompt/parser here
 * now also cover the `dimensions` axis (`BehaviorDimensionChange[]`),
 * orthogonal to `verdict` — see `spec/protocol/semantic-revision-judge.ts`'s
 * `SemanticRevisionJudgmentDraft` docstring for the full semantic/behavior
 * axis split. Trial 4's `deepseek` frontier-reference role instead uses
 * `OpenRouterSemanticRevisionJudge` (reached via OpenRouter, not DeepSeek's
 * own API), which maintains its own semantically-equivalent v3 prompt/
 * schema — see this module's next paragraph for why the two are not
 * unified into one implementation.
 *
 * OpenRouter's provider (`openrouter-semantic-revision-judge.ts`) does NOT
 * use this module — it relies on OpenRouter's `response_format: json_schema`
 * strict structured output instead, a materially different (and stronger)
 * wire guarantee. Do not switch it to this module without a deliberate,
 * separate decision to give up that guarantee. It uses its own JSON Schema
 * (kept in sync with this module's verdict/dimension/direction values) and
 * the same `isValidDimensionsArray` validator from `behavior-dimension.ts`.
 */

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/i;
const MARKDOWN_JSON_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
/** The MLX-LM local server's Qwen chat template appends this end-of-turn transport token after the model's actual completion text — observed verbatim in real local Qwen3-0.6B output, both plain and fenced. Anchored to end-of-string (`$`) so only a genuine TRAILING token is stripped, never an occurrence elsewhere (never used to hunt for JSON embedded in prose). */
const TRAILING_QWEN_IM_END_PATTERN = /\s*<\|im_end\|>\s*$/i;

/**
 * Test 1's narrow judge prompt (docs/decisions/0016's Trial 3 §8,
 * extended by docs/decisions/0017's Test 1 addendum), deliberately kept
 * identical across every transport using this wire protocol, so a
 * benchmark comparing outputs across transports (Trial 4) is not
 * confounded by prompt differences — the only intended variable is the
 * model/weights behind the transport. Not enlarged beyond what the two
 * orthogonal axes require to compensate for a smaller model (Trial 3 §8).
 */
export function buildNarrowJudgePrompt(input: SemanticRevisionJudgeInput): string {
  return [
    'You are judging one localized human text revision.\n\n',
    `Operation: ${input.kind}\n`,
    `Context before: "${input.beforeContext}"\n`,
    `Original span: "${input.originalText}"\n`,
    `Final span: "${input.finalText}"\n`,
    `Context after: "${input.afterContext}"\n\n`,
    'There are TWO SEPARATE questions to answer.\n\n',
    '(1) SEMANTIC/PRACTICAL VERDICT — did this revision change the ',
    'underlying proposition or practical meaning, in a directly ',
    'observable way?\n\n',
    'Do not infer personality, motivation, psychology, identity, or stable ',
    'preferences. Do not discuss anything beyond this one localized ',
    'revision — no other part of the text, no aggregation, no repeated ',
    'patterns.\n\n',
    'A textual change may preserve meaning. If the proposition/practical ',
    'meaning is essentially preserved, verdict is "no_meaningful_change".\n\n',
    'If meaning is added, removed, or transformed, verdict is ',
    '"meaning_added", "meaning_removed", or "meaning_transformed", and ',
    'description is one short sentence describing only that narrow ',
    'semantic change, grounded only in the original span, the final span, ',
    'and the given context. Otherwise description is null.\n\n',
    'If unsure, verdict is "uncertain" and description is null.\n\n',
    '(2) OBSERVABLE BEHAVIORAL DIMENSIONS — separately from the verdict ',
    'above, did the EXPRESSED wording change along any of these ',
    'dimensions, regardless of whether the proposition itself changed? A ',
    'change here does NOT require a semantic verdict other than ',
    '"no_meaningful_change" — many genuine dimension changes happen while ',
    'the underlying proposition stays exactly the same (e.g. tone, ',
    'certainty, or politeness shifting while the claim itself does not).\n\n',
    `Allowed dimension(direction) pairs — ONLY these pairings are valid: ${formatCanonicalDimensionDirections()}.\n\n`,
    'Only describe DIRECTLY OBSERVABLE changes in expressed wording/stance ',
    '— never infer the human\'s actual internal emotion, mood, or ',
    'psychological state. "expressed_affect_valence"/"expressed_affect_intensity" ',
    'describe the TEXT\'s expressed affect, not a claim about how the ',
    'person actually feels.\n\n',
    'dimensions is an array of {"dimension": ..., "direction": ...} pairs. ',
    'It may be empty — an empty array is a valid, expected answer meaning ',
    '"no observable behavioral shift." Never include the same dimension ',
    'twice. If verdict is "uncertain", dimensions must be an empty array.\n\n',
    'This applies regardless of language; reason about the underlying ',
    'meaning/behavior shift itself, not language-specific wording, ',
    'suffixes, or grammar.\n\n',
    'Respond with EXACTLY one JSON object and nothing else — no ',
    'explanation, no Markdown, no extra text before or after it. The JSON ',
    'object must have exactly these four keys:\n',
    '{"verdict": "<one of: no_meaningful_change, meaning_added, ',
    'meaning_removed, meaning_transformed, uncertain>", "dimensions": ',
    '[{"dimension": "<...>", "direction": "<...>"}, ...], "description": ',
    '<string or null>, "confidence": <number between 0 and 1>}',
  ].join('');
}

/** Strips one leading `<think>...</think>` reasoning block, if present. Never persisted/logged by any caller. */
function stripThinkingBlock(content: string): string {
  return content.replace(THINK_BLOCK_PATTERN, '').trim();
}

/** Strips a single surrounding Markdown code fence, if the entire trimmed content is wrapped in exactly one. Does not recover a fence embedded in surrounding prose. */
function stripMarkdownFence(content: string): string {
  const match = content.match(MARKDOWN_JSON_FENCE_PATTERN);
  return match ? match[1] : content;
}

/**
 * Strips ONLY an exact trailing `<|im_end|>` transport token (plus
 * surrounding whitespace), if present at the very end of the string.
 * Observed real local MLX/Qwen3-0.6B output: a valid JSON payload
 * immediately followed by this token, e.g. `{"verdict": ...}<|im_end|>` or
 * a fenced ` ```json\n{...}\n``` <|im_end|>`. Anchored to end-of-string —
 * never strips the token from the middle of prose, never a signal to hunt
 * for JSON elsewhere in the content (same "harmless transport formatting
 * only, never repair" discipline as `stripThinkingBlock`/`stripMarkdownFence`).
 */
function stripTrailingQwenImEndToken(content: string): string {
  return content.replace(TRAILING_QWEN_IM_END_PATTERN, '');
}

const VALID_VERDICTS = new Set([
  'no_meaningful_change',
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'uncertain',
]);

function isValidJudgmentWireShape(value: unknown): value is SemanticRevisionJudgmentDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (typeof draft.verdict !== 'string' || !VALID_VERDICTS.has(draft.verdict)) return false;
  if (draft.description !== null && typeof draft.description !== 'string') return false;
  if (typeof draft.confidence !== 'number') return false;
  if (!isValidDimensionsArray(draft.dimensions)) return false;
  if (draft.verdict === 'uncertain' && (draft.dimensions as unknown[]).length > 0) return false;
  return true;
}

/**
 * Parses a raw chat-completion `content` string into a validated
 * `SemanticRevisionJudgmentDraft`, or throws. Tolerates only harmless
 * transport formatting (surrounding whitespace, one `<think>` block, one
 * trailing `<|im_end|>` transport token, one Markdown JSON fence) — never
 * repairs, guesses, or infers a missing/malformed field; a response that
 * fails structural validation is a judge failure, not degraded evidence
 * (Trial 3 §10-11). This includes `dimensions`: a missing/malformed
 * `dimensions` array, a duplicate dimension, an unrecognized dimension/
 * direction value, or a non-empty `dimensions` array on an `'uncertain'`
 * verdict are all rejected here, never silently repaired to `[]`.
 *
 * Normalization pipeline, in this exact order (each step only strips
 * known, harmless transport artifacts — never extracts `{...}` from
 * surrounding prose, never repairs malformed JSON):
 * 1. strip a leading `<think>...</think>` block, if present
 * 2. strip a trailing `<|im_end|>` token, if present
 * 3. trim surrounding whitespace
 * 4. strip a single surrounding Markdown JSON fence, if present
 * 5. `JSON.parse`
 * 6. strict schema validation (`isValidJudgmentWireShape`)
 */
export function parseUntrustedJudgmentText(content: string): SemanticRevisionJudgmentDraft {
  const withoutThinking = stripThinkingBlock(content);
  const withoutTransportToken = stripTrailingQwenImEndToken(withoutThinking).trim();
  const jsonText = stripMarkdownFence(withoutTransportToken);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('response content is not valid JSON');
  }

  if (!isValidJudgmentWireShape(parsed)) {
    throw new Error('response did not match the expected semantic revision judgment schema');
  }

  return parsed;
}
