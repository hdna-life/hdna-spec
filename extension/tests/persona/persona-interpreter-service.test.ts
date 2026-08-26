import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { PatternStore } from '../../src/persona/pattern-store';
import { TraitBeliefStore } from '../../src/persona/trait-belief-store';
import { PersonaInterpreterConfigStore } from '../../src/persona/persona-interpreter-config-store';
import { PersonaInterpreterService } from '../../src/persona/persona-interpreter-service';
import type { Pattern } from '@spec/schema/pattern';
import type { PatternCandidate, PersonaInterpreterProvider, TraitBeliefClaimDraft } from '@spec/protocol/persona-interpreter';

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    dimension: 'formality',
    context: 'unscoped',
    value: 0.5,
    confidenceWeight: 3,
    sampleCount: 3,
    supportingRecordIds: ['a', 'b', 'c'],
    compilerId: 'deterministic-aggregate',
    compilerVersion: '1.0.0',
    computedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function installFakeChromeStorageLocal(): void {
  const data: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        },
      },
    },
  };
}

function fakeProvider(drafts: TraitBeliefClaimDraft[]): { provider: PersonaInterpreterProvider; interpret: ReturnType<typeof vi.fn> } {
  const interpret = vi.fn(async () => drafts);
  const provider: PersonaInterpreterProvider = { providerId: 'fake', modelId: 'fake-model', interpret };
  return { provider, interpret };
}

function setup(drafts: TraitBeliefClaimDraft[] = []) {
  installFakeChromeStorageLocal();
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const patternStore = new PatternStore(storage);
  const traitBeliefStore = new TraitBeliefStore(storage);
  const configStore = new PersonaInterpreterConfigStore();
  const { provider, interpret } = fakeProvider(drafts);
  const createProvider = vi.fn(() => provider);
  const service = new PersonaInterpreterService(createProvider, patternStore, traitBeliefStore, configStore, {
    minPatternCount: 2,
  });
  return { service, patternStore, traitBeliefStore, configStore, createProvider, interpret };
}

describe('PersonaInterpreterService', () => {
  it('throws when not enabled/configured', async () => {
    const { service } = setup();
    await expect(service.interpret()).rejects.toThrow(/not enabled\/configured/);
  });

  it('completes as a no-op, with no provider call, when below the pattern threshold', async () => {
    const { service, patternStore, configStore, createProvider } = setup();
    await configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'fake-model' });
    await patternStore.put(pattern());

    const result = await service.interpret();
    expect(result).toEqual([]);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('interprets eligible patterns, writes validated claims, and drops invalid drafts', async () => {
    const validDraft: TraitBeliefClaimDraft = {
      claim: 'prioritizes implementation simplicity',
      context: 'unscoped',
      confidence: 0.6,
      supportingPatternKeys: ['formality:unscoped'],
    };
    const invalidDraft: TraitBeliefClaimDraft = {
      claim: 'hallucinated claim',
      context: 'unscoped',
      confidence: 0.5,
      supportingPatternKeys: ['madeUpDimension:unscoped'],
    };
    const { service, patternStore, traitBeliefStore, configStore, interpret } = setup([validDraft, invalidDraft]);
    await configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'fake-model' });
    await patternStore.put(pattern({ dimension: 'formality' }));
    await patternStore.put(pattern({ dimension: 'directness' }));

    const claims = await service.interpret();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      claim: 'prioritizes implementation simplicity',
      interpreterId: 'fake',
      interpreterModelId: 'fake-model',
    });
    await expect(traitBeliefStore.list()).resolves.toHaveLength(1);

    // Not given the previous claim set — called with only the candidates.
    expect(interpret).toHaveBeenCalledTimes(1);
    const [candidates] = interpret.mock.calls[0] as [PatternCandidate[]];
    expect(candidates.sort((a, b) => a.dimension.localeCompare(b.dimension))).toEqual([
      { dimension: 'directness', context: 'unscoped', value: 0.5, sampleCount: 3 },
      { dimension: 'formality', context: 'unscoped', value: 0.5, sampleCount: 3 },
    ]);
  });

  it('atomically replaces the previous claim set on a fresh interpretation run', async () => {
    const draft: TraitBeliefClaimDraft = {
      claim: 'new claim',
      context: 'unscoped',
      confidence: 0.6,
      supportingPatternKeys: ['formality:unscoped'],
    };
    const { service, patternStore, traitBeliefStore, configStore } = setup([draft]);
    await configStore.set({ enabled: true, apiKey: 'sk-or-test', modelId: 'fake-model' });
    await patternStore.put(pattern({ dimension: 'formality' }));
    await patternStore.put(pattern({ dimension: 'directness' }));

    await traitBeliefStore.put({
      id: 'stale',
      claim: 'stale claim',
      context: 'unscoped',
      confidence: 0.5,
      supportingPatternKeys: ['formality:unscoped'],
      interpreterId: 'openrouter',
      interpreterModelId: 'old-model',
      computedAt: '2025-01-01T00:00:00.000Z',
    });

    await service.interpret();
    const claims = await traitBeliefStore.list();
    expect(claims).toHaveLength(1);
    expect(claims[0].claim).toBe('new claim');
  });
});
