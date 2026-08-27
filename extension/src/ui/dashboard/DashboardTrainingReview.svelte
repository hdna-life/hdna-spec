<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import type { SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
  import type { Trial4ImportMode } from '../../persona/trial4-training-candidate-import';
  import {
    VERDICT_LABELS_TR,
    VERDICT_ORDER,
    EXCLUSION_REASON_LABELS_TR,
    EXCLUSION_REASON_ORDER,
    filterCandidates,
    isReviewed,
    isDisagreement,
    computeReviewStats,
    type Trial4ReviewFilter,
  } from '../../persona/trial4-review-state';

  export let candidates: Trial4TrainingCandidate[] = [];

  const dispatch = createEventDispatcher<{
    importCandidates: { candidates: Trial4TrainingCandidate[]; mode: Trial4ImportMode };
    update: Trial4TrainingCandidate;
    clearAll: void;
  }>();

  const FILTERS: { value: Trial4ReviewFilter; label: string }[] = [
    { value: 'pending', label: 'Bekleyen' },
    { value: 'all', label: 'Tümü' },
    { value: 'disagreement', label: 'Anlaşmazlık' },
    { value: 'lore', label: 'Lore' },
    { value: 'included', label: 'Dahil' },
    { value: 'excluded', label: 'Hariç' },
  ];

  let filter: Trial4ReviewFilter = 'pending';
  let currentIndex = 0;

  $: filtered = filterCandidates(candidates, filter);
  $: current = filtered[Math.min(currentIndex, Math.max(filtered.length - 1, 0))];
  $: stats = computeReviewStats(candidates);

  // Local-only UI mode for the currently-viewed candidate — not persisted
  // until the operator actually picks a verdict (valid path) or a reason
  // (bad path), so an undecided in-progress candidate never silently
  // leaves the "pending" filter mid-decision.
  type DecisionMode = 'undecided' | 'valid' | 'bad';
  $: derivedMode = deriveMode(current);
  let modeOverride: DecisionMode | null = null;
  $: mode = modeOverride ?? derivedMode;
  // Reset the local override only when the VIEWED CANDIDATE actually
  // changes (by id), never merely because `current`'s object reference
  // changed. The dashboard polls refresh() every 2s
  // (entrypoints/dashboard/App.svelte), which re-fetches candidates from
  // IndexedDB as brand-new object references on every tick even when
  // nothing changed — a naive `$: current?.id, (modeOverride = null)`
  // re-runs on every such poll (Svelte's reactive statements re-run
  // whenever a *reassigned* dependency is touched, regardless of whether
  // the derived value differs), silently closing the "Kötü örnek" panel
  // out from under the operator every ~2s, before they could pick a
  // reason. Comparing against the last-seen id by value fixes this.
  let lastCandidateId: string | undefined;
  $: {
    if (current?.id !== lastCandidateId) {
      lastCandidateId = current?.id;
      modeOverride = null;
    }
  }

  function deriveMode(candidate: Trial4TrainingCandidate | undefined): DecisionMode {
    if (!candidate) return 'undecided';
    if (candidate.includeInTraining) return 'valid';
    if (isReviewed(candidate) && !candidate.includeInTraining) return 'bad';
    return 'undecided';
  }

  function setFilter(next: Trial4ReviewFilter) {
    filter = next;
    currentIndex = 0;
  }

  function goNext() {
    if (currentIndex < filtered.length - 1) currentIndex += 1;
  }

  function goPrev() {
    if (currentIndex > 0) currentIndex -= 1;
  }

  function pushUpdate(patch: Partial<Trial4TrainingCandidate>) {
    if (!current) return;
    dispatch('update', { ...current, ...patch });
  }

  function selectVerdict(verdict: SemanticChangeVerdict) {
    if (!current) return;
    pushUpdate({
      humanVerdict: verdict,
      includeInTraining: true,
      exclusionReasons: [],
      reviewedAt: new Date().toISOString(),
    });
    modeOverride = 'valid';
    goNext();
  }

  function enterBadMode() {
    modeOverride = 'bad';
  }

  function enterValidMode() {
    modeOverride = 'valid';
  }

  function toggleExclusionReason(reason: (typeof EXCLUSION_REASON_ORDER)[number]) {
    if (!current) return;
    const has = current.exclusionReasons.includes(reason);
    const nextReasons = has
      ? current.exclusionReasons.filter((r) => r !== reason)
      : [...current.exclusionReasons, reason];
    pushUpdate({
      humanVerdict: null,
      includeInTraining: false,
      exclusionReasons: nextReasons,
      // Only the FIRST reason picked marks this candidate reviewed — an
      // empty in-progress exclusion (mode opened, nothing chosen yet)
      // must not vanish from the "pending" filter.
      reviewedAt: nextReasons.length > 0 ? (current.reviewedAt ?? new Date().toISOString()) : current.reviewedAt,
    });
  }

  function updateOperatorNote(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    pushUpdate({ operatorNoteTr: value });
  }

  function toggleLore() {
    if (!current) return;
    pushUpdate({ loreImportant: !current.loreImportant, loreNoteTr: current.loreImportant ? null : current.loreNoteTr });
  }

  function updateLoreNote(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    pushUpdate({ loreNoteTr: value });
  }

  async function handleImportFile(event: Event, mode: Trial4ImportMode) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Seçilen dosya geçerli bir JSON değil.');
      input.value = '';
      return;
    }
    if (!Array.isArray(parsed)) {
      alert('Bir JSON dizisi (candidate objeleri) bekleniyor.');
      input.value = '';
      return;
    }
    if (mode === 'replace') {
      const confirmed = confirm(
        'Mevcut tüm Trial 4 eğitim adayları silinip yerine bu dosyadaki adaylar mı yüklensin? Bu işlem geri alınamaz.',
      );
      if (!confirmed) {
        input.value = '';
        return;
      }
    }
    dispatch('importCandidates', { candidates: parsed as Trial4TrainingCandidate[], mode });
    input.value = '';
  }

  function handleClearAll() {
    const confirmed = confirm('Tüm Trial 4 eğitim adaylarını temizlemek istediğinize emin misiniz? Bu işlem geri alınamaz.');
    if (!confirmed) return;
    dispatch('clearAll');
  }

  function isTypingInField(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!current || isTypingInField(event)) return;
    if (event.key >= '1' && event.key <= '5') {
      const idx = Number(event.key) - 1;
      selectVerdict(VERDICT_ORDER[idx]);
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'x':
        enterBadMode();
        break;
      case 'l':
        toggleLore();
        break;
      case 'arrowright':
      case 'n':
        goNext();
        break;
      case 'arrowleft':
      case 'p':
        goPrev();
        break;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<section class="review">
  <header class="toolbar">
    <div class="filters">
      {#each FILTERS as f}
        <button class:active={filter === f.value} on:click={() => setFilter(f.value)}>{f.label}</button>
      {/each}
    </div>
    <div class="import-group">
      <label class="import-label">
        Mevcutlara ekle
        <input type="file" accept="application/json" on:change={(e) => handleImportFile(e, 'append')} />
      </label>
      <label class="import-label">
        Temizle ve içe aktar
        <input type="file" accept="application/json" on:change={(e) => handleImportFile(e, 'replace')} />
      </label>
      <button class="danger" on:click={handleClearAll}>Tüm adayları temizle</button>
    </div>
  </header>

  <div class="progress">
    <div class="progress-bar">
      <div class="progress-fill" style="width: {stats.total > 0 ? (stats.reviewed / stats.total) * 100 : 0}%"></div>
    </div>
    <span class="progress-label">{stats.reviewed} / {stats.total} incelendi · bu filtrede {filtered.length} örnek</span>
  </div>

  {#if !current}
    <p class="empty">Bu filtrede gösterilecek aday yok.</p>
  {:else}
    <div class="nav">
      <button on:click={goPrev} disabled={currentIndex === 0}>← Önceki (P)</button>
      <span class="position">{currentIndex + 1} / {filtered.length}</span>
      <button on:click={goNext} disabled={currentIndex >= filtered.length - 1}>Sonraki (N) →</button>
    </div>

    <article class="candidate">
      <div class="block context-block">
        <h3>Bağlam</h3>
        <p class="context-line">
          <span class="ctx">{current.beforeContext || '—'}</span>
          <span class="op-badge">{current.kind}</span>
          <span class="ctx">{current.afterContext || '—'}</span>
        </p>
      </div>

      <div class="block original-block">
        <h3>Original</h3>
        <p class="big-text">{current.originalText || '(boş)'}</p>
      </div>

      <div class="block final-block">
        <h3>Final</h3>
        <p class="big-text">{current.finalText || '(boş)'}</p>
      </div>

      <div class="block proposal-block">
        <h3>DeepSeek Önerisi</h3>
        <p><strong>{VERDICT_LABELS_TR[current.proposedVerdict]}</strong> ({current.proposedVerdict})</p>
        {#if current.proposedDescription}<p class="proposal-desc">{current.proposedDescription}</p>{/if}
      </div>

      {#if current.reviewNoteTr}
        <div class="block tr-block">
          <h3>Türkçe İnceleme Yardımı (model tarafından üretildi)</h3>
          <p>{current.reviewNoteTr}</p>
        </div>
      {/if}

      <div class="block decision-block">
        <h3>Kararınız</h3>
        <div class="mode-buttons">
          <button class:active={mode === 'valid'} class="mode-valid" on:click={enterValidMode}>Geçerli örnek</button>
          <button class:active={mode === 'bad'} class="mode-bad" on:click={enterBadMode}>Kötü örnek / eğitimden çıkar (X)</button>
        </div>

        {#if mode === 'valid' || mode === 'undecided'}
          <div class="verdict-grid">
            {#each VERDICT_ORDER as verdict, i}
              <button
                class="verdict-btn"
                class:selected={current.humanVerdict === verdict}
                class:model-proposed={current.proposedVerdict === verdict}
                on:click={() => selectVerdict(verdict)}
              >
                <span class="key-hint">{i + 1}</span>
                {VERDICT_LABELS_TR[verdict]}
              </button>
            {/each}
          </div>
          {#if current.humanVerdict !== null && isDisagreement(current)}
            <p class="disagreement-note">
              ⚠ Model önerisi ({VERDICT_LABELS_TR[current.proposedVerdict]}) ile farklı — her iki değer de saklanıyor.
            </p>
          {/if}
        {/if}

        {#if mode === 'bad'}
          <div class="reason-grid">
            {#each EXCLUSION_REASON_ORDER as reason}
              <label class="reason-item">
                <input
                  type="checkbox"
                  checked={current.exclusionReasons.includes(reason)}
                  on:change={() => toggleExclusionReason(reason)}
                />
                {EXCLUSION_REASON_LABELS_TR[reason]}
              </label>
            {/each}
          </div>
          <label class="note-field">
            Neden kötü? / Not
            <textarea rows="2" value={current.operatorNoteTr} on:blur={updateOperatorNote}></textarea>
          </label>
        {/if}
      </div>

      <div class="block lore-block">
        <label class="lore-toggle">
          <input type="checkbox" checked={current.loreImportant} on:change={toggleLore} />
          Lore için önemli (L)
        </label>
        {#if current.loreImportant}
          <label class="note-field">
            Bu örnek bize ne öğretiyor?
            <textarea rows="3" value={current.loreNoteTr ?? ''} on:blur={updateLoreNote}></textarea>
          </label>
        {/if}
      </div>
    </article>

    <p class="hints">Kısayollar: 1-5 karar · X kötü örnek · L lore · ← → önceki/sonraki</p>
  {/if}
</section>

<style>
  .review {
    max-width: 900px;
    margin: 0 auto;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
  }
  .filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .filters button {
    padding: 8px 14px;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: #fff;
    cursor: pointer;
  }
  .filters button.active {
    background: #2a6b3f;
    color: #fff;
    border-color: #2a6b3f;
  }
  .import-group {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .import-label {
    font-size: 13px;
    color: #555;
  }
  button.danger {
    padding: 8px 14px;
    font-size: 13px;
    border-radius: 6px;
    border: 1px solid #c0392b;
    background: #fbe9e7;
    color: #a33;
    cursor: pointer;
  }
  .progress {
    margin-bottom: 16px;
  }
  .progress-bar {
    height: 8px;
    background: #eee;
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #2a6b3f;
  }
  .progress-label {
    font-size: 13px;
    color: #666;
  }
  .empty {
    font-size: 16px;
    color: #666;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .nav button {
    padding: 8px 16px;
    font-size: 14px;
  }
  .position {
    font-size: 14px;
    color: #555;
  }
  .candidate {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .block {
    padding: 16px 20px;
    border-radius: 8px;
    background: #fafafa;
    border: 1px solid #e5e5e5;
  }
  .block h3 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #777;
  }
  .context-block {
    background: #f5f5f5;
  }
  .context-line {
    margin: 0;
    font-size: 15px;
    color: #888;
    font-style: italic;
  }
  .op-badge {
    display: inline-block;
    margin: 0 8px;
    padding: 2px 8px;
    background: #e5e5e5;
    border-radius: 4px;
    font-style: normal;
    font-size: 12px;
    color: #444;
  }
  .original-block {
    border-left: 4px solid #c0392b;
  }
  .final-block {
    border-left: 4px solid #2a8f4e;
  }
  .big-text {
    font-size: 19px;
    line-height: 1.6;
    margin: 0;
  }
  .proposal-block {
    background: #f0f4f8;
  }
  .proposal-desc {
    margin: 6px 0 0;
    font-size: 15px;
    color: #333;
  }
  .tr-block {
    background: #fff7e6;
  }
  .decision-block {
    background: #fff;
    border: 2px solid #ddd;
  }
  .mode-buttons {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
  }
  .mode-buttons button {
    flex: 1;
    padding: 12px;
    font-size: 15px;
    border-radius: 6px;
    border: 2px solid #ccc;
    background: #fff;
    cursor: pointer;
  }
  .mode-valid.active {
    border-color: #2a8f4e;
    background: #e6f4ea;
  }
  .mode-bad.active {
    border-color: #c0392b;
    background: #fbe9e7;
  }
  .verdict-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .verdict-btn {
    padding: 14px;
    font-size: 15px;
    text-align: left;
    border-radius: 6px;
    border: 2px solid #ccc;
    background: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .verdict-btn.selected {
    border-color: #2a6b3f;
    background: #e6f4ea;
    font-weight: 600;
  }
  .verdict-btn.model-proposed:not(.selected) {
    border-style: dashed;
  }
  .key-hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: #eee;
    font-size: 12px;
    color: #555;
  }
  .disagreement-note {
    margin-top: 10px;
    font-size: 14px;
    color: #a35a00;
  }
  .reason-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .reason-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .note-field {
    display: block;
    font-size: 14px;
    margin-top: 8px;
  }
  .note-field textarea {
    width: 100%;
    box-sizing: border-box;
    font-size: 15px;
    font-family: inherit;
    padding: 8px;
    margin-top: 4px;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .lore-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .hints {
    margin-top: 16px;
    font-size: 13px;
    color: #888;
    text-align: center;
  }
</style>
