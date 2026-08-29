import type {
  SemanticRevisionJudgeInput,
  SemanticRevisionJudgeProvider,
  SemanticRevisionJudgmentDraft,
} from '@spec/protocol/semantic-revision-judge';
import { SEMANTIC_REVISION_JUDGE_VERSION } from './semantic-revision-judge-identity';
import {
  BEHAVIOR_DIMENSIONS,
  CANONICAL_DIMENSION_DIRECTIONS,
  formatCanonicalDimensionDirections,
  isValidDimensionsArray,
} from './behavior-dimension';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export { SEMANTIC_REVISION_JUDGE_VERSION };

// Strict OpenAI/Azure-compatible structured outputs require every
// `properties` key to also appear in `required`, and every nested object
// to declare `additionalProperties: false`.
const JUDGMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['no_meaningful_change', 'meaning_added', 'meaning_removed', 'meaning_transformed', 'uncertain'],
    },
    dimensions: {
      type: 'array',
      items: {
        // One branch per dimension, each constraining direction to its own
        // allowed set — rejected at the schema level, not just post-parse.
        anyOf: BEHAVIOR_DIMENSIONS.map((dimension) => ({
          type: 'object',
          properties: {
            dimension: { type: 'string', enum: [dimension] },
            direction: { type: 'string', enum: [...CANONICAL_DIMENSION_DIRECTIONS[dimension]] },
          },
          required: ['dimension', 'direction'],
          additionalProperties: false,
        })),
      },
    },
    description: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['verdict', 'dimensions', 'description', 'confidence'],
  additionalProperties: false,
} as const;

/** No wording here names a language or language-specific grammatical form — regression-tested. */
function buildPrompt(input: SemanticRevisionJudgeInput): string {
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
    'meaning is essentially preserved, return verdict "no_meaningful_change".\n\n',
    'If meaning is added, removed, or transformed, return the matching ',
    'verdict ("meaning_added", "meaning_removed", or ',
    '"meaning_transformed") and describe only that narrow semantic change ',
    'in "description" — one short sentence, grounded only in the original ',
    'span, the final span, and the given context. Otherwise description is ',
    'null.\n\n',
    'If unsure, return verdict "uncertain" and description null.\n\n',
    '(2) OBSERVABLE BEHAVIORAL DIMENSIONS — separately from the verdict ',
    'above, did the EXPRESSED wording change along any of these ',
    'dimensions, regardless of whether the proposition itself changed? A ',
    'change here does NOT require a semantic verdict other than ',
    '"no_meaningful_change" — many genuine dimension changes happen while ',
    'the underlying proposition stays exactly the same.\n\n',
    `Allowed dimension(direction) pairs — ONLY these pairings are valid: ${formatCanonicalDimensionDirections()}.\n\n`,
    'Only describe DIRECTLY OBSERVABLE changes in expressed wording/stance ',
    '— never infer the human\'s actual internal emotion, mood, or ',
    'psychological state.\n\n',
    'dimensions is an array of {"dimension": ..., "direction": ...} pairs, ',
    'possibly empty (meaning "no observable behavioral shift"). Never ',
    'include the same dimension twice. If verdict is "uncertain", ',
    'dimensions must be an empty array.\n\n',
    'This applies regardless of language; reason about the underlying ',
    'meaning/behavior shift itself, not language-specific wording, ',
    'suffixes, or grammar.',
  ].join('');
}

function isValidJudgmentWireShape(value: unknown): value is SemanticRevisionJudgmentDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  const validVerdicts = new Set([
    'no_meaningful_change',
    'meaning_added',
    'meaning_removed',
    'meaning_transformed',
    'uncertain',
  ]);
  if (typeof draft.verdict !== 'string' || !validVerdicts.has(draft.verdict)) return false;
  if (draft.description !== null && typeof draft.description !== 'string') return false;
  if (typeof draft.confidence !== 'number') return false;
  if (!isValidDimensionsArray(draft.dimensions)) return false;
  if (draft.verdict === 'uncertain' && (draft.dimensions as unknown[]).length > 0) return false;
  return true;
}

/**
 * `modelId` is caller-configured, never overridden — a model that can't
 * satisfy the structured-output contract makes `judge()` throw rather than
 * silently falling back to a stronger model.
 *
 * `fetch.bind(globalThis)` default is required — a bare `fetch` default
 * breaks in MV3 (native `fetch` is receiver-checked; `this.fetchImpl(...)`
 * without binding throws "Illegal invocation"). Do not remove the bind.
 */
export class OpenRouterSemanticRevisionJudge implements SemanticRevisionJudgeProvider {
  readonly providerId = `openrouter/${SEMANTIC_REVISION_JUDGE_VERSION}`;

  constructor(
    private apiKey: string,
    readonly modelId: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async judge(input: SemanticRevisionJudgeInput): Promise<SemanticRevisionJudgmentDraft> {
    const response = await this.fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'semantic_revision_judgment', strict: true, schema: JUDGMENT_JSON_SCHEMA },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('OpenRouter response missing message content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('OpenRouter response content is not valid JSON');
    }

    if (!isValidJudgmentWireShape(parsed)) {
      throw new Error('OpenRouter response did not match the expected semantic revision judgment schema');
    }

    return parsed;
  }
}
