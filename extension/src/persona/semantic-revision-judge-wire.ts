import type { SemanticRevisionJudgeInput, SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

/**
 * Shared "untrusted JSON wire protocol" for any `SemanticRevisionJudgeProvider`
 * transport that cannot rely on a provider-enforced structured-output
 * contract (`response_format`/JSON-Schema) — currently
 * `LocalMlxSemanticRevisionJudge` (docs/decisions/0016's Trial 3 "local MLX
 * transport" addendum) and `DeepSeekSemanticRevisionJudge` (Trial 4's
 * benchmark reference provider, docs/decisions/0017). Both providers ask
 * the model, in-prompt, to return exactly one JSON object, then run the
 * exact same defensive parse/validate here — extracted to this module so
 * the "untrusted output, no repair, reject on malformed" discipline (Trial
 * 3 §10-11) is defined and tested in exactly one place rather than
 * duplicated per transport. Neither provider assumes the other's
 * transport-specific behavior (HTTP envelope, auth, error classification)
 * lives here — this module has no `fetch`/HTTP/API-key concept at all.
 *
 * OpenRouter's provider (`openrouter-semantic-revision-judge.ts`) does NOT
 * use this module — it relies on OpenRouter's `response_format: json_schema`
 * strict structured output instead, a materially different (and stronger)
 * wire guarantee. Do not switch it to this module without a deliberate,
 * separate decision to give up that guarantee.
 */

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/i;
const MARKDOWN_JSON_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

const VALID_VERDICTS = new Set([
  'no_meaningful_change',
  'meaning_added',
  'meaning_removed',
  'meaning_transformed',
  'uncertain',
]);

/**
 * Trial 3's narrow judge prompt (docs/decisions/0016's Trial 3 §8),
 * deliberately kept identical across every transport using this wire
 * protocol, so a benchmark comparing outputs across transports (Trial 4)
 * is not confounded by prompt differences — the only intended variable is
 * the model/weights behind the transport. Not enlarged to compensate for
 * a smaller model (Trial 3 §8).
 */
export function buildNarrowJudgePrompt(input: SemanticRevisionJudgeInput): string {
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

/** Strips one leading `<think>...</think>` reasoning block, if present. Never persisted/logged by any caller. */
function stripThinkingBlock(content: string): string {
  return content.replace(THINK_BLOCK_PATTERN, '').trim();
}

/** Strips a single surrounding Markdown code fence, if the entire trimmed content is wrapped in exactly one. Does not recover a fence embedded in surrounding prose. */
function stripMarkdownFence(content: string): string {
  const match = content.match(MARKDOWN_JSON_FENCE_PATTERN);
  return match ? match[1] : content;
}

function isValidJudgmentWireShape(value: unknown): value is SemanticRevisionJudgmentDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (typeof draft.verdict !== 'string' || !VALID_VERDICTS.has(draft.verdict)) return false;
  if (draft.description !== null && typeof draft.description !== 'string') return false;
  if (typeof draft.confidence !== 'number') return false;
  return true;
}

/**
 * Parses a raw chat-completion `content` string into a validated
 * `SemanticRevisionJudgmentDraft`, or throws. Tolerates only harmless
 * transport formatting (surrounding whitespace, one `<think>` block, one
 * Markdown JSON fence) — never repairs, guesses, or infers a missing/
 * malformed field; a response that fails structural validation is a judge
 * failure, not degraded evidence (Trial 3 §10-11).
 */
export function parseUntrustedJudgmentText(content: string): SemanticRevisionJudgmentDraft {
  const withoutThinking = stripThinkingBlock(content);
  const jsonText = stripMarkdownFence(withoutThinking);

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
