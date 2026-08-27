import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageAdapter } from '../../src/storage/indexeddb-adapter';
import { Trial4BenchmarkCaseStore } from '../../src/persona/trial4-benchmark-case-store';
import { Trial4BenchmarkResultStore } from '../../src/persona/trial4-benchmark-result-store';
import { Trial4BenchmarkConfigStore } from '../../src/persona/trial4-benchmark-config-store';
import { Trial4BenchmarkService, type Trial4ProviderSet } from '../../src/persona/trial4-benchmark-service';
import type { Trial4BenchmarkCase } from '@spec/schema/trial4-benchmark-case';
import type { SemanticRevisionJudgeProvider, SemanticRevisionJudgmentDraft } from '@spec/protocol/semantic-revision-judge';

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

const VALID_CONFIG = {
  enabled: true,
  baseModelUrl: 'http://127.0.0.1:8080',
  trainedModelUrl: 'http://127.0.0.1:8081',
  localModelId: 'Qwen/Qwen3-0.6B',
  deepSeekApiKey: 'sk-deepseek-test',
  deepSeekModelId: 'deepseek-v4-flash',
};

const CASE_1: Trial4BenchmarkCase = {
  id: 'case-1',
  kind: 'replaced',
  originalText: 'X',
  finalText: 'Y',
  beforeContext: 'A',
  afterContext: 'B',
};

function fakeProvider(judgeFn: () => Promise<SemanticRevisionJudgmentDraft>): SemanticRevisionJudgeProvider {
  return { providerId: 'fake', modelId: 'fake-model', judge: vi.fn(judgeFn) };
}

const ALWAYS_TRANSFORMED = () =>
  Promise.resolve<SemanticRevisionJudgmentDraft>({ verdict: 'meaning_transformed', description: 'x', confidence: 0.7 });

function setup() {
  installFakeChromeStorageLocal();
  const storage = new IndexedDbStorageAdapter(`hdna-test-${Math.random()}`);
  const caseStore = new Trial4BenchmarkCaseStore(storage);
  const resultStore = new Trial4BenchmarkResultStore(storage);
  const configStore = new Trial4BenchmarkConfigStore();
  return { storage, caseStore, resultStore, configStore };
}

function buildService(
  ctx: ReturnType<typeof setup>,
  providers: Trial4ProviderSet,
  randomLabelOrder?: () => ('A' | 'B' | 'C')[],
) {
  const createProviders = vi.fn(() => providers);
  const service = new Trial4BenchmarkService(
    createProviders,
    ctx.caseStore,
    ctx.resultStore,
    ctx.configStore,
    randomLabelOrder,
  );
  return { service, createProviders };
}

describe('Trial4BenchmarkService', () => {
  it('throws when not enabled/configured', async () => {
    const ctx = setup();
    await ctx.caseStore.put(CASE_1);
    const providers = {
      base: fakeProvider(ALWAYS_TRANSFORMED),
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    };
    const { service } = buildService(ctx, providers);
    await expect(service.runNextCase()).rejects.toThrow(/not enabled\/configured/);
  });

  it('returns undefined when there are no unbenchmarked cases (no cases at all)', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    const providers = {
      base: fakeProvider(ALWAYS_TRANSFORMED),
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    };
    const { service } = buildService(ctx, providers);
    await expect(service.runNextCase()).resolves.toBeUndefined();
  });

  it('calls all three providers exactly once each for one case', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const base = fakeProvider(ALWAYS_TRANSFORMED);
    const trained = fakeProvider(ALWAYS_TRANSFORMED);
    const deepseek = fakeProvider(ALWAYS_TRANSFORMED);
    const { service } = buildService(ctx, { base, trained, deepseek });

    await service.runNextCase();
    expect(base.judge).toHaveBeenCalledTimes(1);
    expect(trained.judge).toHaveBeenCalledTimes(1);
    expect(deepseek.judge).toHaveBeenCalledTimes(1);
  });

  it('sends the exact case fields to every provider', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const base = fakeProvider(ALWAYS_TRANSFORMED);
    const { service } = buildService(ctx, {
      base,
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    });

    await service.runNextCase();
    expect(base.judge).toHaveBeenCalledWith({
      kind: 'replaced',
      originalText: 'X',
      finalText: 'Y',
      beforeContext: 'A',
      afterContext: 'B',
    });
  });

  it('persists a result with role always attached to every label, regardless of randomization', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const { service } = buildService(
      ctx,
      { base: fakeProvider(ALWAYS_TRANSFORMED), trained: fakeProvider(ALWAYS_TRANSFORMED), deepseek: fakeProvider(ALWAYS_TRANSFORMED) },
      () => ['B', 'C', 'A'],
    );

    const result = await service.runNextCase();
    expect(result).toBeDefined();
    const roles = ['A', 'B', 'C'].map((label) => result!.labelMapping[label as 'A' | 'B' | 'C'].role);
    expect(new Set(roles)).toEqual(new Set(['base', 'trained', 'deepseek']));
  });

  it('randomization actually determines which label each role lands on (injected order respected)', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    // roles are evaluated in fixed order [base, trained, deepseek]; injected label order ['B','C','A']
    // means base -> B, trained -> C, deepseek -> A.
    const { service } = buildService(
      ctx,
      { base: fakeProvider(ALWAYS_TRANSFORMED), trained: fakeProvider(ALWAYS_TRANSFORMED), deepseek: fakeProvider(ALWAYS_TRANSFORMED) },
      () => ['B', 'C', 'A'],
    );

    const result = await service.runNextCase();
    expect(result!.labelMapping.B.role).toBe('base');
    expect(result!.labelMapping.C.role).toBe('trained');
    expect(result!.labelMapping.A.role).toBe('deepseek');
  });

  it('a provider failure for one role is recorded as that label\'s error, and does not abort the case', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const failing = fakeProvider(() => Promise.reject(new Error('Local MLX server unreachable at http://127.0.0.1:8081')));
    const { service } = buildService(
      ctx,
      { base: fakeProvider(ALWAYS_TRANSFORMED), trained: failing, deepseek: fakeProvider(ALWAYS_TRANSFORMED) },
      () => ['A', 'B', 'C'],
    );

    const result = await service.runNextCase();
    expect(result).toBeDefined();
    const trainedResponse = result!.labelMapping.B; // roles [base,trained,deepseek] -> labels [A,B,C]
    expect(trainedResponse.role).toBe('trained');
    expect(trainedResponse.error).toMatch(/unreachable/);
    expect(trainedResponse.verdict).toBeNull();
    // the other two roles still produced valid judgments
    expect(result!.labelMapping.A.error).toBeNull();
    expect(result!.labelMapping.C.error).toBeNull();
  });

  it('a case is only ever benchmarked once — a second runNextCase call skips it', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const base = fakeProvider(ALWAYS_TRANSFORMED);
    const { service } = buildService(ctx, {
      base,
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    });

    const first = await service.runNextCase();
    expect(first).toBeDefined();
    const second = await service.runNextCase();
    expect(second).toBeUndefined();
    expect(base.judge).toHaveBeenCalledTimes(1);
  });

  it('a new result starts unjudged and unrevealed', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const { service } = buildService(ctx, {
      base: fakeProvider(ALWAYS_TRANSFORMED),
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    });

    const result = await service.runNextCase();
    expect(result!.judged).toBe(false);
    expect(result!.revealed).toBe(false);
    expect(result!.bestResponse).toBeNull();
  });

  describe('submitJudgment', () => {
    it('records grades per label, bestResponse, and note, and flips judged to true', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();

      const updated = await service.submitJudgment(
        result!.id,
        { A: 'correct', B: 'wrong', C: 'partial' },
        'A',
        'base was clearly best',
      );

      expect(updated.judged).toBe(true);
      expect(updated.judgedAt).toBeTruthy();
      expect(updated.bestResponse).toBe('A');
      expect(updated.note).toBe('base was clearly best');
      expect(updated.labelMapping.A.grade).toBe('correct');
      expect(updated.labelMapping.B.grade).toBe('wrong');
      expect(updated.labelMapping.C.grade).toBe('partial');
    });

    it('throws when re-judging an already-judged result', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      await service.submitJudgment(result!.id, { A: 'correct', B: 'wrong', C: 'wrong' }, 'A', '');

      await expect(
        service.submitJudgment(result!.id, { A: 'wrong', B: 'correct', C: 'wrong' }, 'B', 'changed my mind'),
      ).rejects.toThrow(/already been judged/);
    });

    it('supports "tie" as a valid bestResponse', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      const updated = await service.submitJudgment(result!.id, { A: 'correct', B: 'correct', C: 'wrong' }, 'tie', '');
      expect(updated.bestResponse).toBe('tie');
    });
  });

  describe('reveal', () => {
    it('flips revealed to true without touching grade/bestResponse/note', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      const judged = await service.submitJudgment(result!.id, { A: 'correct', B: 'wrong', C: 'wrong' }, 'A', 'clear winner');

      const revealed = await service.reveal(judged.id);

      expect(revealed.revealed).toBe(true);
      expect(revealed.judged).toBe(true);
      expect(revealed.bestResponse).toBe('A');
      expect(revealed.note).toBe('clear winner');
      expect(revealed.labelMapping.A.grade).toBe('correct');
      expect(revealed.labelMapping.B.grade).toBe('wrong');
      expect(revealed.labelMapping.C.grade).toBe('wrong');
    });

    it('can be called even before judging (revealed and judged are independent flags)', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      const revealed = await service.reveal(result!.id);
      expect(revealed.revealed).toBe(true);
      expect(revealed.judged).toBe(false);
    });
  });

  it('constructs providers fresh from current config on every call (never a stale endpoint)', async () => {
    const ctx = setup();
    await ctx.configStore.set(VALID_CONFIG);
    await ctx.caseStore.put(CASE_1);
    const { service, createProviders } = buildService(ctx, {
      base: fakeProvider(ALWAYS_TRANSFORMED),
      trained: fakeProvider(ALWAYS_TRANSFORMED),
      deepseek: fakeProvider(ALWAYS_TRANSFORMED),
    });

    await service.runNextCase();
    expect(createProviders).toHaveBeenCalledWith(expect.objectContaining(VALID_CONFIG));
  });
});
