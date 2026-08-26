<script lang="ts">
  import type { ExpressionSheet } from '@spec/schema/expression-sheet';

  export let sheet: ExpressionSheet | undefined;
</script>

<section>
  <h2>Expression Sheet</h2>
  {#if !sheet}
    <p>No samples compiled yet.</p>
  {:else}
    <ul>
      <li>Sentences analyzed: {sheet.sentenceLengthTokens?.sampleSize ?? 0}</li>
      <li>Mean sentence length: {sheet.sentenceLengthTokens?.mean.toFixed(1) ?? '-'} tokens</li>
      <li>Lowercase sentence starts: {((sheet.lowercaseStartProbability ?? 0) * 100).toFixed(0)}%</li>
      <li>Emoji per word: {((sheet.emojiUsageRate ?? 0) * 100).toFixed(1)}%</li>
    </ul>
  {/if}
</section>

<style>
  section {
    margin-bottom: 10px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    color: #666;
    margin: 0 0 4px;
  }
  p,
  ul {
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  ul {
    list-style: none;
  }
</style>
