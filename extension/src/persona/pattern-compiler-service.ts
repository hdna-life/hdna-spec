import type { Pattern } from '@spec/schema/pattern';
import type { PatternCompilerPolicy } from '@spec/schema/pattern-compiler-policy';
import { DEFAULT_PATTERN_COMPILER_POLICY } from '@spec/schema/pattern-compiler-policy';
import type { T2Dimension } from '@spec/schema/t2-dimensions';
import type { EditMetricsStore } from './edit-metrics-store';
import type { EditEventStore } from './edit-event-store';
import type { TraitScoreStore } from './trait-score-store';
import type { WritingSampleStore } from './sample-store';
import type { PatternStore } from './pattern-store';
import { aggregateObservations, type ScoredObservation } from './pattern-compiler';

const UNSCOPED_CONTEXT = 'unscoped';

/**
 * Gathers derived-evidence observations (EditMetrics, TraitScoreRecord),
 * resolves each observation's context from its source evidence, and
 * compiles them into Patterns. Expensive/rare — the design doc's P3 class —
 * intended to run as a manually-triggered background job, not per-item.
 */
export class PatternCompilerService {
  constructor(
    private editMetricsStore: EditMetricsStore,
    private editEventStore: EditEventStore,
    private traitScoreStore: TraitScoreStore,
    private sampleStore: WritingSampleStore,
    private patternStore: PatternStore,
    private policy: PatternCompilerPolicy = DEFAULT_PATTERN_COMPILER_POLICY,
  ) {}

  private async resolveContext(sourceType: string, sourceId: string): Promise<string> {
    if (sourceType === 'writing_sample') {
      const sample = await this.sampleStore.get(sourceId);
      return sample?.context?.surface ?? UNSCOPED_CONTEXT;
    }
    if (sourceType === 'edit_event') {
      const event = await this.editEventStore.get(sourceId);
      return event?.context?.surface ?? UNSCOPED_CONTEXT;
    }
    return UNSCOPED_CONTEXT;
  }

  private async gatherObservations(): Promise<ScoredObservation[]> {
    const observations: ScoredObservation[] = [];

    for (const metrics of await this.editMetricsStore.list()) {
      const context = await this.resolveContext('edit_event', metrics.editEventId);
      const recordId = `edit_event:${metrics.editEventId}`;
      observations.push({ dimension: 'compressionRatio', context, value: metrics.compressionRatio, confidence: 1, recordId });
      observations.push({ dimension: 'lexicalOverlap', context, value: metrics.lexicalOverlap, confidence: 1, recordId });
    }

    for (const trait of await this.traitScoreStore.list()) {
      const context = await this.resolveContext(trait.sourceType, trait.sourceId);
      const recordId = `${trait.sourceType}:${trait.sourceId}`;
      for (const dimension of Object.keys(trait.scores) as T2Dimension[]) {
        const value = trait.scores[dimension];
        const confidence = trait.confidence[dimension];
        if (value === undefined || confidence === undefined) continue;
        observations.push({ dimension, context, value, confidence, recordId });
      }
    }

    return observations;
  }

  /** Discards existing patterns and recompiles from every derived-evidence record currently in storage. Returns the compiled Patterns. */
  async compile(): Promise<Pattern[]> {
    const observations = await this.gatherObservations();
    const patterns = aggregateObservations(observations, this.policy);

    await this.patternStore.clear();
    for (const pattern of patterns) await this.patternStore.put(pattern);

    return patterns;
  }
}
