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
  openRouterApiKey: 'sk-or-test',
  deepSeekModelId: 'deepseek/deepseek-chat-v3.1',
};

// Locked by default — most tests in this file exercise running/judging/
// revealing, not the lock gate itself (see the dedicated
// "ground truth lock gating" describe block below for that).
const CASE_1: Trial4BenchmarkCase = {
  id: 'case-1',
  kind: 'replaced',
  originalText: 'X',
  finalText: 'Y',
  beforeContext: 'A',
  afterContext: 'B',
  humanVerdict: 'meaning_transformed',
  humanDimensions: [],
  groundTruthLocked: true,
  groundTruthLockedAt: '2026-01-01T00:00:00.000Z',
};

function fakeProvider(judgeFn: () => Promise<SemanticRevisionJudgmentDraft>): SemanticRevisionJudgeProvider {
  return { providerId: 'fake', modelId: 'fake-model', judge: vi.fn(judgeFn) };
}

const ALWAYS_TRANSFORMED = () =>
  Promise.resolve<SemanticRevisionJudgmentDraft>({ verdict: 'meaning_transformed', dimensions: [], description: 'x', confidence: 0.7 });

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

  describe('submitJudgment (acceptability gate + ranking, docs/decisions/0017 addendum)', () => {
    it('records acceptability/rank per label, derives bestResponse from rank 1, and flips judged to true', async () => {
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
        {
          A: { acceptable: true, rank: 1 },
          B: { acceptable: false, rank: null },
          C: { acceptable: true, rank: 2 },
        },
        'A was clearly best',
      );

      expect(updated.judged).toBe(true);
      expect(updated.judgedAt).toBeTruthy();
      expect(updated.bestResponse).toBe('A');
      expect(updated.note).toBe('A was clearly best');
      expect(updated.labelMapping.A.humanAcceptable).toBe(true);
      expect(updated.labelMapping.A.humanRank).toBe(1);
      expect(updated.labelMapping.B.humanAcceptable).toBe(false);
      expect(updated.labelMapping.B.humanRank).toBeNull();
      expect(updated.labelMapping.C.humanAcceptable).toBe(true);
      expect(updated.labelMapping.C.humanRank).toBe(2);
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
      await service.submitJudgment(
        result!.id,
        { A: { acceptable: true, rank: 1 }, B: { acceptable: false, rank: null }, C: { acceptable: false, rank: null } },
        '',
      );

      await expect(
        service.submitJudgment(
          result!.id,
          { A: { acceptable: false, rank: null }, B: { acceptable: true, rank: 1 }, C: { acceptable: false, rank: null } },
          'changed my mind',
        ),
      ).rejects.toThrow(/already been judged/);
    });

    it('rejects a rank on an unacceptable response', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();

      await expect(
        service.submitJudgment(
          result!.id,
          { A: { acceptable: false, rank: 1 }, B: { acceptable: false, rank: null }, C: { acceptable: false, rank: null } },
          '',
        ),
      ).rejects.toThrow(/must not carry a rank/);
    });

    it('rejects a non-dense or duplicate ranking among acceptable responses', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();

      await expect(
        service.submitJudgment(
          result!.id,
          { A: { acceptable: true, rank: 1 }, B: { acceptable: true, rank: 1 }, C: { acceptable: false, rank: null } },
          '',
        ),
      ).rejects.toThrow(/dense/);
    });

    it('records a case with zero acceptable responses — bestResponse is null, not an error', async () => {
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
        { A: { acceptable: false, rank: null }, B: { acceptable: false, rank: null }, C: { acceptable: false, rank: null } },
        'none acceptable',
      );

      expect(updated.judged).toBe(true);
      expect(updated.bestResponse).toBeNull();
    });

    it('gives the single acceptable response rank 1 as bestResponse when the other two are unacceptable', async () => {
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
        { A: { acceptable: false, rank: null }, B: { acceptable: true, rank: 1 }, C: { acceptable: false, rank: null } },
        '',
      );

      expect(updated.bestResponse).toBe('B');
    });
  });

  describe('reveal', () => {
    it('flips revealed to true without touching humanAcceptable/humanRank/bestResponse/note', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      const judged = await service.submitJudgment(
        result!.id,
        { A: { acceptable: true, rank: 1 }, B: { acceptable: false, rank: null }, C: { acceptable: false, rank: null } },
        'clear winner',
      );

      const revealed = await service.reveal(judged.id);

      expect(revealed.revealed).toBe(true);
      expect(revealed.judged).toBe(true);
      expect(revealed.bestResponse).toBe('A');
      expect(revealed.note).toBe('clear winner');
      expect(revealed.labelMapping.A.humanAcceptable).toBe(true);
      expect(revealed.labelMapping.A.humanRank).toBe(1);
      expect(revealed.labelMapping.B.humanAcceptable).toBe(false);
      expect(revealed.labelMapping.C.humanAcceptable).toBe(false);
    });

    it('throws when called before the blind evaluation is committed (judged=false) — Test 1 evaluation-stage addendum', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      await expect(service.reveal(result!.id)).rejects.toThrow(/before the blind evaluation is committed/);
    });

    it('succeeds once judged, and reveal never mutates the already-committed judgment fields', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put(CASE_1);
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });
      const result = await service.runNextCase();
      const judged = await service.submitJudgment(
        result!.id,
        { A: { acceptable: true, rank: 1 }, B: { acceptable: false, rank: null }, C: { acceptable: false, rank: null } },
        'before reveal',
      );

      const revealed = await service.reveal(judged.id);

      expect(revealed.revealed).toBe(true);
      expect(revealed.bestResponse).toBe(judged.bestResponse);
      expect(revealed.note).toBe(judged.note);
      expect(revealed.labelMapping).toEqual(judged.labelMapping);
    });
  });

  describe('lockGroundTruth (Test 1 evaluation-stage addendum)', () => {
    it('locks a case with a valid verdict + dimensions, setting groundTruthLockedAt', async () => {
      const ctx = setup();
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      const locked = await service.lockGroundTruth('case-1', 'meaning_added', [
        { dimension: 'certainty', direction: 'increased' },
      ]);

      expect(locked.groundTruthLocked).toBe(true);
      expect(locked.humanVerdict).toBe('meaning_added');
      expect(locked.humanDimensions).toEqual([{ dimension: 'certainty', direction: 'increased' }]);
      expect(locked.groundTruthLockedAt).toBeTruthy();
    });

    it('throws when re-locking an already-locked case', async () => {
      const ctx = setup();
      await ctx.caseStore.put(CASE_1); // already locked in the fixture
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      await expect(service.lockGroundTruth(CASE_1.id, 'meaning_added', [])).rejects.toThrow(/already locked/);
    });

    it('throws on an invalid verdict', async () => {
      const ctx = setup();
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      // @ts-expect-error deliberately invalid for this test
      await expect(service.lockGroundTruth(CASE_1.id, 'not_a_real_verdict', [])).rejects.toThrow(/Invalid ground truth verdict/);
    });

    it('throws when uncertain carries non-empty dimensions', async () => {
      const ctx = setup();
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      await expect(
        service.lockGroundTruth(CASE_1.id, 'uncertain', [{ dimension: 'certainty', direction: 'increased' }]),
      ).rejects.toThrow(/must carry dimensions: \[\]/);
    });

    it('throws on a duplicate dimension', async () => {
      const ctx = setup();
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      await expect(
        service.lockGroundTruth(CASE_1.id, 'meaning_added', [
          { dimension: 'certainty', direction: 'increased' },
          { dimension: 'certainty', direction: 'decreased' },
        ]),
      ).rejects.toThrow(/Invalid ground truth dimensions/);
    });

    it('accepts no_meaningful_change with non-empty dimensions (expression-only shift)', async () => {
      const ctx = setup();
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      const locked = await service.lockGroundTruth('case-1', 'no_meaningful_change', [
        { dimension: 'certainty', direction: 'increased' },
      ]);
      expect(locked.groundTruthLocked).toBe(true);
    });
  });

  describe('ground truth lock gating on runNextCase (models must not run before groundTruthLocked=true)', () => {
    it('skips a case whose ground truth is not locked', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      await ctx.caseStore.put({ ...CASE_1, humanVerdict: null, humanDimensions: [], groundTruthLocked: false });
      const base = fakeProvider(ALWAYS_TRANSFORMED);
      const { service } = buildService(ctx, {
        base,
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      const result = await service.runNextCase();
      expect(result).toBeUndefined();
      expect(base.judge).not.toHaveBeenCalled();
    });

    it('runs a locked case and skips an unlocked one that was imported alongside it', async () => {
      const ctx = setup();
      await ctx.configStore.set(VALID_CONFIG);
      const unlocked: Trial4BenchmarkCase = {
        ...CASE_1,
        id: 'case-unlocked',
        humanVerdict: null,
        humanDimensions: [],
        groundTruthLocked: false,
      };
      await ctx.caseStore.put(unlocked);
      await ctx.caseStore.put(CASE_1); // locked
      const { service } = buildService(ctx, {
        base: fakeProvider(ALWAYS_TRANSFORMED),
        trained: fakeProvider(ALWAYS_TRANSFORMED),
        deepseek: fakeProvider(ALWAYS_TRANSFORMED),
      });

      const result = await service.runNextCase();
      expect(result).toBeDefined();
      expect(result!.caseId).toBe(CASE_1.id);

      const second = await service.runNextCase();
      expect(second).toBeUndefined(); // only unlocked case left
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
