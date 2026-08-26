import type {
  SemanticDeltaCandidateDraft,
  SemanticDeltaExtractionInput,
  SemanticDeltaExtractorProvider,
} from '@spec/protocol/semantic-delta-extractor';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Strict OpenAI/Azure-compatible structured outputs require every
// `properties` key to also appear in `required` — a property cannot be
// "optional" at the JSON Schema level under `strict: true`. HDNA's domain
// model keeps `preferred`/`rejected` genuinely optional (meaningless for
// `behavioral_delta`), so the wire schema instead makes them nullable
// (`type: ['string', 'null']`) and always-`required`, and this file
// normalizes `null` back to `undefined` after validating the response —
// see `isValidWireDraftShape`/`normalizeWireDraft` below and
// docs/decisions/0016. Do not add `preferred`/`rejected` to the domain
// `SemanticDeltaCandidateDraft`'s required fields to work around this;
// only the wire representation changes.
const CANDIDATE_DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['contrastive_preference', 'behavioral_delta'] },
          observation: { type: 'string' },
          preferred: { type: ['string', 'null'] },
          rejected: { type: ['string', 'null'] },
          context: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['kind', 'observation', 'preferred', 'rejected', 'context', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

function buildPrompt(input: SemanticDeltaExtractionInput): string {
  return [
    'You extract grounded semantic preference/behavioral differences from a ',
    'single transformation of an AI-generated draft into a human’s final ',
    'edited text. Describe only preference or behavioral differences directly ',
    'supported by the transformation from original AI output to human final ',
    'text. Do not infer stable personality, psychology, motivation, ',
    'demographics, identity, or unrelated beliefs. Abstain when no meaningful ',
    'semantic preference is evidenced — return an empty candidates array ',
    'rather than guessing.\n\n',
    'Each candidate has a "kind": use "contrastive_preference" ONLY when the ',
    'edit genuinely kept one thing over another — in that case, also give ',
    '"preferred" (what was kept) and "rejected" (what it moved away from). ',
    'Otherwise, for any other directly-observable semantic difference (added ',
    'or removed reasoning, strengthened or weakened a position, changed ',
    'framing, etc.) that does not reduce to a clean preference pair, use ',
    '"behavioral_delta" and describe it only in "observation" — do not ',
    'invent a "preferred"/"rejected" pair just to fill those fields. Every ',
    'candidate object must still include "preferred" and "rejected" keys; ',
    'set them to null when they do not apply (i.e. for "behavioral_delta", ',
    'or whenever there is no genuine preference pair).\n\n',
    `Context: ${input.context}\n\n`,
    `Original AI draft:\n${input.originalText}\n\n`,
    `Human final text:\n${input.finalText}`,
  ].join('');
}

/**
 * Wire-level shape actually returned by the OpenRouter response, distinct
 * from the domain `SemanticDeltaCandidateDraft`: `preferred`/`rejected` are
 * always-present keys per the strict JSON Schema above, but their value is
 * `string | null` rather than optional — `null` is how the model spells
 * "not applicable" under a schema where every property must be `required`.
 */
interface OpenRouterCandidateDraftWire {
  kind: 'contrastive_preference' | 'behavioral_delta';
  observation: string;
  preferred: string | null;
  rejected: string | null;
  context: string;
  confidence: number;
}

function isValidWireDraftShape(value: unknown): value is OpenRouterCandidateDraftWire {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (draft.kind !== 'contrastive_preference' && draft.kind !== 'behavioral_delta') return false;
  if (typeof draft.observation !== 'string') return false;
  if (typeof draft.context !== 'string') return false;
  if (typeof draft.confidence !== 'number') return false;
  if (draft.preferred !== null && typeof draft.preferred !== 'string') return false;
  if (draft.rejected !== null && typeof draft.rejected !== 'string') return false;
  return true;
}

/**
 * Normalizes the wire representation's `string | null` `preferred`/
 * `rejected` back to the domain model's `string | undefined` — the only
 * place this provider-specific `null` convention is translated. Everything
 * downstream of `extract()` (validateCandidateDraft, the service, storage)
 * continues to see exactly the same optional-field shape it always has.
 */
function normalizeWireDraft(wire: OpenRouterCandidateDraftWire): SemanticDeltaCandidateDraft {
  return {
    kind: wire.kind,
    observation: wire.observation,
    preferred: wire.preferred ?? undefined,
    rejected: wire.rejected ?? undefined,
    context: wire.context,
    confidence: wire.confidence,
  };
}

/**
 * Concrete SemanticDeltaExtractorProvider backed by OpenRouter (a model
 * gateway, not a single model — modelId is caller-configurable, expected
 * to be a cheap/small model for this validation phase). The sole owner of
 * fetch/API-key handling; the SemanticDeltaExtractorProvider interface
 * itself has no such concept.
 *
 * Unlike OpenRouterPersonaInterpreter (docs/decisions/0015), this class
 * DOES send raw evidence text (originalText/finalText) — that is Phase
 * 5A's documented, intentional privacy-boundary difference from T3, not
 * an oversight. See docs/decisions/0016.
 *
 * A malformed/unparseable response throws rather than inventing fallback
 * data — same discipline as OpenRouterPersonaInterpreter.
 */
export class OpenRouterSemanticDeltaExtractor implements SemanticDeltaExtractorProvider {
  readonly providerId = 'openrouter';

  constructor(
    private apiKey: string,
    readonly modelId: string,
    // Bound to globalThis from day one — see docs/decisions/0015's real
    // MV3 "Illegal invocation" bug (this.fetchImpl(...) otherwise calls
    // native fetch with the wrong receiver). Do not reintroduce a bare
    // `fetch` default here.
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async extract(input: SemanticDeltaExtractionInput): Promise<SemanticDeltaCandidateDraft[]> {
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
          json_schema: { name: 'semantic_delta_candidates', strict: true, schema: CANDIDATE_DRAFT_JSON_SCHEMA },
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

    const candidates = (parsed as { candidates?: unknown })?.candidates;
    if (!Array.isArray(candidates) || !candidates.every(isValidWireDraftShape)) {
      throw new Error('OpenRouter response did not match the expected candidates schema');
    }

    return candidates.map(normalizeWireDraft);
  }
}
