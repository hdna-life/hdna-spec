import type {
  SemanticDeltaCandidateDraft,
  SemanticDeltaExtractionInput,
  SemanticDeltaExtractorProvider,
} from '@spec/protocol/semantic-delta-extractor';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Identifies the *extraction instruction/prompt revision*, independent of
 * `modelId` (the actual OpenRouter model, sent verbatim as the request's
 * `model` field — never suffixed or altered by this constant). Bump this
 * when `buildPrompt()`'s extraction contract changes in a way that should
 * count as a distinct extractor for receipt/idempotency purposes (see
 * `providerId` below and `SemanticDeltaExtractionService.runExperiment()`),
 * so an intentional prompt revision can reprocess sources a prior revision
 * already produced a receipt for, without weakening same-version
 * idempotency. See docs/decisions/0016's Trial 1 section.
 *
 * v1: baseline (docs/decisions/0016's first real dogfood run — 66.7%
 * SUPPORTED, groundedness FAIL).
 * v2 (`transformation-grounded`): Trial 1 — grounds every candidate in the
 * ORIGINAL -> FINAL transformation specifically (PRESERVED meaning is not
 * evidence; only ADDED/REMOVED/TRANSFORMED meaning is), via a mandatory
 * counterfactual check. No schema/candidate-kind/architecture change.
 */
export const EXTRACTION_PROMPT_VERSION = 'transformation-grounded-v1';

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
    'edited text.\n\n',

    // --- Trial 1 core rule ---------------------------------------------
    'CORE RULE: a semantic delta is not the meaning of the final text. A ',
    'semantic delta is a directional change in meaning attributable to the ',
    'human transformation from the ORIGINAL to the FINAL text. Meaning can ',
    'be PRESERVED, ADDED, REMOVED, or TRANSFORMED by that transformation. ',
    'PRESERVED meaning — anything already true of the ORIGINAL that simply ',
    'remains true (however differently worded) in the FINAL — is NOT new ',
    'evidence about the human and must not become a candidate. Only ',
    'meaning that was ADDED, REMOVED, or materially TRANSFORMED by the ',
    'edit may become a candidate.\n\n',

    // --- Mandatory counterfactual grounding check -----------------------
    'MANDATORY CHECK before emitting every candidate: would this exact ',
    'observation still be fully supported if you had only ever seen the ',
    'ORIGINAL AI draft, and never saw the human’s final text? If YES — the ',
    'observation is already true of the ORIGINAL — do NOT emit it; it is ',
    'preserved/pre-existing meaning, not evidence contributed by the human. ',
    'If NO — the observation genuinely requires the FINAL text to be true ',
    '— continue evaluating whether the ORIGINAL -> FINAL difference ',
    'actually, directly supports it before emitting it.\n\n',

    // --- Textual diff != semantic delta ----------------------------------
    'Textual difference magnitude is not proof of semantic difference, in ',
    'either direction. A very small wording change can express a large ',
    'change in meaning (e.g. a shift in certainty, commitment, ',
    'conditionality, stance, intensity, framing, specificity, directness, ',
    'formality, or interpersonal stance — this list is illustrative, not ',
    'exhaustive; other kinds of semantic/pragmatic change are equally ',
    'valid). A very large rewrite can preserve essentially the same ',
    'meaning. Do not use edit distance, word-count difference, or the ',
    'presence of paraphrasing as evidence of semantic change by itself — ',
    'reason about whether the meaning actually changed, not about how much ',
    'text changed. This applies regardless of language; do not rely on any ',
    'language-specific wording, suffix, or construction — reason about the ',
    'underlying meaning shift itself (e.g. unconditional -> conditional), ',
    'however it happens to be expressed in this particular text.\n\n',

    // --- Observation-first boundary (unchanged from baseline) -----------
    'Do not infer stable personality, psychology, motivation, ',
    'demographics, identity, or unrelated beliefs from a single edit. ',
    'Record only the transformation actually supported by the text — e.g. ',
    '"the human changed an unconditional statement into a conditional ',
    'one" or "the human strengthened the commitment expressed in this ',
    'statement" is allowed when directly supported; "the user is ',
    'indecisive" or "the user avoids commitment" is not — those require ',
    'repeated evidence and a later aggregation stage this experiment does ',
    'not perform. Abstain when no meaningful, transformation-grounded ',
    'semantic preference or behavioral difference is evidenced — return an ',
    'empty candidates array rather than guessing or than restating a ',
    'preserved property of the ORIGINAL. Fewer, well-grounded candidates ',
    'are better than more, loosely-grounded ones — do not optimize for ',
    'candidate count.\n\n',

    // --- kind / preferred / rejected (unchanged from baseline) -----------
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
 *
 * `providerId` encodes `EXTRACTION_PROMPT_VERSION`, not just the gateway
 * name — `SemanticDeltaExtractionService.runExperiment()`'s idempotency
 * check keys off `extractorId`+`extractorVersion` (providerId+modelId), so
 * a prompt revision that changes what gets extracted must also change
 * `providerId` for an intentional re-extraction to actually re-run against
 * sources a prior prompt revision already produced a receipt for — modelId
 * alone can't carry that distinction, since it must stay exactly what's
 * sent to OpenRouter's `model` field. See EXTRACTION_PROMPT_VERSION above
 * and docs/decisions/0016's Trial 1 section.
 */
export class OpenRouterSemanticDeltaExtractor implements SemanticDeltaExtractorProvider {
  readonly providerId = `openrouter/${EXTRACTION_PROMPT_VERSION}`;

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
