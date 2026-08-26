import type { TraitBeliefClaim } from '@spec/schema/trait-belief';
import type { PersonaInterpreterPolicy } from '@spec/schema/persona-interpreter-policy';
import { DEFAULT_PERSONA_INTERPRETER_POLICY } from '@spec/schema/persona-interpreter-policy';
import type { PersonaInterpreterProvider } from '@spec/protocol/persona-interpreter';
import type { PatternStore } from './pattern-store';
import type { TraitBeliefStore } from './trait-belief-store';
import type { PersonaInterpreterConfigStore } from './persona-interpreter-config-store';
import { isEligibleForInterpretation, patternKey, toPatternCandidate, validateClaimDraft } from './persona-interpreter';

/**
 * Orchestrates T3 interpretation: PatternStore -> (deterministic threshold
 * gate) -> provider.interpret() -> validated TraitBeliefClaims ->
 * TraitBeliefStore. Expensive/rare (P3), manually triggered — same
 * "compile()-style full rebuild" contract as PatternCompilerService.
 */
export type PersonaInterpreterProviderFactory = (apiKey: string, modelId: string) => PersonaInterpreterProvider;

export class PersonaInterpreterService {
  constructor(
    /**
     * Constructs the provider fresh from the *current* config on every
     * interpret() call, rather than being handed a single provider instance
     * at construction time. background.ts's PersonaInterpreterService is
     * built once at service-worker startup but must never call OpenRouter
     * with a stale API key/model id from an earlier popup save.
     */
    private createProvider: PersonaInterpreterProviderFactory,
    private patternStore: PatternStore,
    private traitBeliefStore: TraitBeliefStore,
    private configStore: PersonaInterpreterConfigStore,
    private policy: PersonaInterpreterPolicy = DEFAULT_PERSONA_INTERPRETER_POLICY,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async interpret(): Promise<TraitBeliefClaim[]> {
    const config = await this.configStore.get();
    if (!config.enabled || !config.apiKey || !config.modelId) {
      throw new Error('AI interpretation is not enabled/configured');
    }

    const patterns = await this.patternStore.list();
    if (!isEligibleForInterpretation(patterns, this.policy)) {
      return this.traitBeliefStore.list();
    }

    const candidates = patterns.map(toPatternCandidate);
    const candidateKeys = new Set(patterns.map(patternKey));
    const provider = this.createProvider(config.apiKey, config.modelId);

    // Deliberately not given the previous claim set: claims are themselves
    // model-generated, not raw observations, so feeding them back in would
    // let a model's own earlier output reinforce/amplify itself across
    // successive runs rather than converge toward better evidence. See
    // docs/decisions/0015.
    const drafts = await provider.interpret(candidates);
    const validDrafts = drafts.filter((draft) => validateClaimDraft(draft, candidateKeys));

    const claims: TraitBeliefClaim[] = validDrafts.map((draft) => ({
      id: crypto.randomUUID(),
      claim: draft.claim,
      context: draft.context,
      confidence: draft.confidence,
      supportingPatternKeys: draft.supportingPatternKeys,
      interpreterId: provider.providerId,
      interpreterModelId: provider.modelId,
      computedAt: this.now(),
    }));

    await this.traitBeliefStore.clear();
    for (const claim of claims) await this.traitBeliefStore.put(claim);

    return claims;
  }
}
