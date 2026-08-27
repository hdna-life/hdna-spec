<script lang="ts">
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import type { Trial4BenchmarkResult } from '@spec/schema/trial4-benchmark-result';
  import { computeReviewStats } from '../../persona/trial4-review-state';
  import { computeTrial4BenchmarkStats } from '../../persona/trial4-benchmark-stats';

  export let candidates: Trial4TrainingCandidate[] = [];
  export let benchmarkResults: Trial4BenchmarkResult[] = [];

  $: reviewStats = computeReviewStats(candidates);
  $: benchmarkStats = computeTrial4BenchmarkStats(benchmarkResults);
  $: hasBenchmark = benchmarkResults.length > 0;
</script>

<section class="overview">
  <h1>Genel Bakış</h1>

  <div class="card">
    <h2>Eğitim Veri Seti (Trial 4)</h2>
    <div class="stat-grid">
      <div class="stat"><span class="value">{reviewStats.total}</span><span class="label">toplam aday</span></div>
      <div class="stat"><span class="value">{reviewStats.reviewed}</span><span class="label">incelendi</span></div>
      <div class="stat"><span class="value">{reviewStats.remaining}</span><span class="label">kalan</span></div>
      <div class="stat">
        <span class="value">{reviewStats.includedInTraining}</span><span class="label">eğitime dahil</span>
      </div>
      <div class="stat"><span class="value">{reviewStats.excluded}</span><span class="label">hariç tutuldu</span></div>
      <div class="stat">
        <span class="value">{reviewStats.disagreements}</span><span class="label">insan/model anlaşmazlığı</span>
      </div>
      <div class="stat"><span class="value">{reviewStats.loreImportant}</span><span class="label">lore-önemli</span></div>
    </div>
  </div>

  <div class="card">
    <h2>Blind Benchmark (Trial 4)</h2>
    {#if !hasBenchmark}
      <p class="empty">Henüz benchmark koşulmadı.</p>
    {:else}
      <div class="stat-grid">
        <div class="stat"><span class="value">{benchmarkStats.judgedResultCount}</span><span class="label">değerlendirilmiş vaka</span></div>
        {#if benchmarkStats.base.acceptabilityJudgedCount > 0}
          <div class="stat">
            <span class="value">{(benchmarkStats.base.acceptableRate * 100).toFixed(0)}%</span>
            <span class="label">base Qwen kabul edilebilir</span>
          </div>
        {/if}
        {#if benchmarkStats.trained.acceptabilityJudgedCount > 0}
          <div class="stat">
            <span class="value">{(benchmarkStats.trained.acceptableRate * 100).toFixed(0)}%</span>
            <span class="label">trained Qwen kabul edilebilir</span>
          </div>
        {/if}
        {#if benchmarkStats.deepseek.acceptabilityJudgedCount > 0}
          <div class="stat">
            <span class="value">{(benchmarkStats.deepseek.acceptableRate * 100).toFixed(0)}%</span>
            <span class="label">DeepSeek (frontier) kabul edilebilir</span>
          </div>
        {/if}
        {#if benchmarkStats.base.acceptabilityJudgedCount > 0 && benchmarkStats.trained.acceptabilityJudgedCount > 0}
          <div class="stat">
            <span class="value">{(benchmarkStats.trainedVsBaseImprovement * 100).toFixed(1)}</span>
            <span class="label">trained − base (puan)</span>
          </div>
        {/if}
        {#if benchmarkStats.noAcceptableResponseCount > 0}
          <div class="stat">
            <span class="value">{benchmarkStats.noAcceptableResponseCount}</span>
            <span class="label">kabul edilebilir yanıt yok</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .overview {
    max-width: 900px;
    margin: 0 auto;
  }
  h1 {
    font-size: 24px;
    margin: 0 0 20px;
  }
  .card {
    background: #fafafa;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 16px;
    color: #444;
  }
  .empty {
    font-size: 15px;
    color: #777;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .value {
    font-size: 28px;
    font-weight: 600;
    color: #222;
  }
  .label {
    font-size: 13px;
    color: #777;
  }
</style>
