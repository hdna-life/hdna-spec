<script lang="ts">
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import {
    buildTrainingDatasetExport,
    buildLoreEvidenceExport,
    buildGenerationFailuresExport,
  } from '../../persona/trial4-review-state';

  export let candidates: Trial4TrainingCandidate[] = [];

  $: trainingDataset = buildTrainingDatasetExport(candidates);
  $: loreEvidence = buildLoreEvidenceExport(candidates);
  $: generationFailures = buildGenerationFailuresExport(candidates);

  function downloadJson(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const today = () => new Date().toISOString().slice(0, 10);
</script>

<section class="exports">
  <h1>Veri / Dışa Aktarımlar</h1>
  <p class="note">
    Bu üç dosya Trial 4'ün insan-incelemeli çıktılarıdır — otomatik olarak
    yeniden eğitim, aday üretimi veya lore güncellemesi tetiklemezler.
    Sonraki açık, hata-güdümlü kararlar için kanıt olarak kullanılır (bkz.
    docs/decisions/0017).
  </p>

  <div class="card">
    <h2>Eğitim Veri Seti</h2>
    <p class="count">{trainingDataset.length} örnek — <code>includeInTraining: true</code>, insan verdict'i ground truth.</p>
    <button on:click={() => downloadJson(`training-dataset-${today()}.json`, trainingDataset)} disabled={trainingDataset.length === 0}>
      training-dataset.json indir
    </button>
  </div>

  <div class="card">
    <h2>Lore Kanıtı</h2>
    <p class="count">{loreEvidence.length} örnek — <code>loreImportant: true</code> (eğitime dahil olup olmadığından bağımsız).</p>
    <button on:click={() => downloadJson(`lore-evidence-${today()}.json`, loreEvidence)} disabled={loreEvidence.length === 0}>
      lore-evidence.json indir
    </button>
  </div>

  <div class="card">
    <h2>Üretim Hataları</h2>
    <p class="count">{generationFailures.length} örnek — hariç tutuldu, nedenler ve operatör notları dahil.</p>
    <button
      on:click={() => downloadJson(`generation-failures-${today()}.json`, generationFailures)}
      disabled={generationFailures.length === 0}
    >
      generation-failures.json indir
    </button>
  </div>
</section>

<style>
  .exports {
    max-width: 900px;
    margin: 0 auto;
  }
  h1 {
    font-size: 24px;
    margin: 0 0 12px;
  }
  .note {
    font-size: 14px;
    color: #666;
    margin-bottom: 20px;
    line-height: 1.6;
  }
  .card {
    background: #fafafa;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
    color: #444;
  }
  .count {
    font-size: 14px;
    color: #555;
    margin-bottom: 12px;
  }
  button {
    padding: 10px 18px;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid #2a6b3f;
    background: #e6f4ea;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
