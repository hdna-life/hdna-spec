import type {
  PatternCandidate,
  PersonaInterpreterProvider,
  TraitBeliefClaimDraft,
} from '@spec/protocol/persona-interpreter';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CLAIM_DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          context: { type: 'string' },
          confidence: { type: 'number' },
          supportingPatternKeys: { type: 'array', items: { type: 'string' } },
        },
        required: ['claim', 'context', 'confidence', 'supportingPatternKeys'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
} as const;

function buildPrompt(candidates: PatternCandidate[]): string {
  return [
    'You interpret aggregated behavioral pattern statistics into conservative, ',
    'evidence-linked personality/worldview claims. Never infer a claim from a ',
    'single pattern. Every claim must cite the dimension:context keys of the ',
    'patterns that support it, using exactly the keys given below — do not ',
    'invent keys. If the evidence does not clearly support any claim, return ',
    'an empty claims array rather than guessing.\n\n',
    'Patterns (dimension:context = value, sampleCount):\n',
    candidates.map((c) => `${c.dimension}:${c.context} = ${c.value} (sampleCount: ${c.sampleCount})`).join('\n'),
  ].join('');
}

function isValidDraftShape(value: unknown): value is TraitBeliefClaimDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.claim === 'string' &&
    typeof draft.context === 'string' &&
    typeof draft.confidence === 'number' &&
    Array.isArray(draft.supportingPatternKeys) &&
    draft.supportingPatternKeys.every((key) => typeof key === 'string')
  );
}

/**
 * Concrete PersonaInterpreterProvider backed by OpenRouter (a model
 * gateway, not a single model — modelId is caller-configurable). The sole
 * owner of fetch/API-key handling in this codebase; the
 * PersonaInterpreterProvider interface itself has no such concept. Prompt
 * content is built only from PatternCandidate[] — never raw evidence, never
 * previously-derived claims (see PersonaInterpreterService for why). A
 * malformed/unparseable response throws rather than inventing fallback
 * data — see docs/decisions/0015.
 */
export class OpenRouterPersonaInterpreter implements PersonaInterpreterProvider {
  readonly providerId = 'openrouter';

  constructor(
    private apiKey: string,
    readonly modelId: string,
    // Bound to globalThis, not a bare reference to `fetch`: native fetch is
    // brand-checked against its receiver, and `this.fetchImpl(...)` below
    // calls it with `this` (the OpenRouterPersonaInterpreter instance) as
    // the receiver, not globalThis — an unbound default throws "Failed to
    // execute 'fetch' on 'WorkerGlobalScope': Illegal invocation" in the
    // real MV3 service worker. Found via manual dogfood; see docs/decisions/0015.
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async interpret(candidates: PatternCandidate[]): Promise<TraitBeliefClaimDraft[]> {
    const response = await this.fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [{ role: 'user', content: buildPrompt(candidates) }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trait_belief_claims', strict: true, schema: CLAIM_DRAFT_JSON_SCHEMA },
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

    const claims = (parsed as { claims?: unknown })?.claims;
    if (!Array.isArray(claims) || !claims.every(isValidDraftShape)) {
      throw new Error('OpenRouter response did not match the expected claims schema');
    }

    return claims;
  }
}
