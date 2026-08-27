<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { RuntimeControlsState } from '../../runtime/controls';
  import Controls from '../Controls.svelte';

  export let controlsState: RuntimeControlsState = { processingPaused: false, learningPaused: false };

  const dispatch = createEventDispatcher<{
    toggleProcessing: void;
    toggleLearning: void;
  }>();
</script>

<section class="settings">
  <h1>Ayarlar</h1>

  <div class="card">
    <Controls
      processingPaused={controlsState.processingPaused}
      learningPaused={controlsState.learningPaused}
      on:toggleProcessing={() => dispatch('toggleProcessing')}
      on:toggleLearning={() => dispatch('toggleLearning')}
    />
  </div>

  <div class="card">
    <h2>Model / API yapılandırması nerede?</h2>
    <ul>
      <li><strong>Trial 4 Benchmark</strong> (base/trained Qwen sunucu URL'leri, DeepSeek API anahtarı) — Benchmark sayfasındaki ayarlar bölümünde.</li>
      <li><strong>Trial 3 semantik yargıç</strong> (local MLX / OpenRouter) ve <strong>Trial 0-2 semantic delta extraction</strong> — popup penceresindeki "Semantic Delta Extraction" panelinde.</li>
    </ul>
    <p class="note">
      Bu ayarlar, dağınıklığı önlemek için kullanıldıkları deney sayfasında
      tutulur; burada tekrarlanmaz.
    </p>
  </div>
</section>

<style>
  .settings {
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
    margin-bottom: 16px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 12px;
    color: #444;
  }
  ul {
    font-size: 14px;
    line-height: 1.8;
    color: #333;
    padding-left: 20px;
    margin: 0 0 8px;
  }
  .note {
    font-size: 13px;
    color: #888;
  }
</style>
