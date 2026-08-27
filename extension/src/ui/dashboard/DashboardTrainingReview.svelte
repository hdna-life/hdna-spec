<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4TrainingCandidate } from '@spec/schema/trial4-training-candidate';
  import type { BehaviorDimension } from '@spec/protocol/semantic-revision-judge';
  import type { Trial4ImportMode } from '../../persona/trial4-training-candidate-import';
  import {
    VERDICT_LABELS_TR,
    EXCLUSION_REASON_LABELS_TR,
    EXCLUSION_REASON_ORDER,
    DIMENSION_LABELS_TR,
    DIRECTION_LABELS_TR,
    DIRECTION_ORDER,
    DIMENSION_GROUPS_TR,
    filterCandidates,
    isReviewed,
    isDisagreement,
    computeReviewStats,
    composeVerdictOption,
    verdictForCompositeOption,
    type Trial4ReviewFilter,
    type Trial4CompositeVerdictOption,
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

  // Six-option composite verdict UI (Test 1 / v3 addendum). Options 1-3 and
  // 6 map straight through to a SemanticChangeVerdict and commit
  // immediately. Option 5 ("Anlamlı değişiklik yok") forces
  // humanDimensions: [] and commits immediately. Option 4 ("Anlam aynı,
  // ifade/ton değişti") sets the verdict but does NOT commit
  // (includeInTraining/reviewedAt) until the operator picks at least one
  // dimension below — mirrors the existing toggleExclusionReason pattern
  // ("only the first reason picked marks reviewed").
  const COMPOSITE_OPTIONS: { option: Trial4CompositeVerdictOption; label: string; key: string }[] = [
    { option: 'meaning_added', label: 'Anlam eklendi', key: '1' },
    { option: 'meaning_removed', label: 'Anlam çıkarıldı', key: '2' },
    { option: 'meaning_transformed', label: 'Anlam dönüştü', key: '3' },
    { option: 'no_meaningful_change_expression_shifted', label: 'Anlam aynı, ifade/ton değişti', key: '4' },
    { option: 'no_meaningful_change_no_shift', label: 'Anlamlı değişiklik yok', key: '5' },
    { option: 'uncertain', label: 'Belirsiz / karar veremiyorum', key: '6' },
  ];

  $: currentComposite = current ? composeVerdictOption(current) : null;

  function selectComposite(option: Trial4CompositeVerdictOption) {
    if (!current) return;
    const verdict = verdictForCompositeOption(option);

    if (option === 'no_meaningful_change_no_shift') {
      pushUpdate({
        humanVerdict: verdict,
        humanDimensions: [],
        includeInTraining: true,
        exclusionReasons: [],
        reviewedAt: new Date().toISOString(),
      });
      modeOverride = 'valid';
      goNext();
      return;
    }

    if (option === 'no_meaningful_change_expression_shifted') {
      // Left incomplete (not reviewed/included) until a dimension is
      // picked — see toggleDimension below.
      pushUpdate({ humanVerdict: verdict, exclusionReasons: [] });
      modeOverride = 'valid';
      return;
    }

    if (option === 'uncertain') {
      // "For this first Test 1 pass, keep it simple: uncertain => []."
      pushUpdate({
        humanVerdict: verdict,
        humanDimensions: [],
        includeInTraining: true,
        exclusionReasons: [],
        reviewedAt: new Date().toISOString(),
      });
      modeOverride = 'valid';
      goNext();
      return;
    }

    // meaning_added / meaning_removed / meaning_transformed — dimensions
    // may also be selected for these (worked example E), so any dimensions
    // already picked are preserved, not cleared.
    pushUpdate({
      humanVerdict: verdict,
      includeInTraining: true,
      exclusionReasons: [],
      reviewedAt: new Date().toISOString(),
    });
    modeOverride = 'valid';
    goNext();
  }

  function toggleDimension(dimension: BehaviorDimension) {
    if (!current) return;
    const has = current.humanDimensions.some((d) => d.dimension === dimension);
    const nextDimensions = has
      ? current.humanDimensions.filter((d) => d.dimension !== dimension)
      : [...current.humanDimensions, { dimension, direction: 'changed' as const }];

    const patch: Partial<Trial4TrainingCandidate> = { humanDimensions: nextDimensions };
    if (current.humanVerdict === 'no_meaningful_change') {
      if (nextDimensions.length > 0) {
        patch.includeInTraining = true;
        patch.reviewedAt = current.reviewedAt ?? new Date().toISOString();
      } else {
        // Removed the only dimension while mid-way through option 4 — this
        // is no longer option 5 (which forces [] explicitly and commits
        // immediately elsewhere), so revert to incomplete/pending.
        patch.includeInTraining = false;
        patch.reviewedAt = undefined;
      }
    }
    pushUpdate(patch);
  }

  function setDimensionDirection(dimension: BehaviorDimension, direction: (typeof DIRECTION_ORDER)[number]) {
    if (!current) return;
    pushUpdate({
      humanDimensions: current.humanDimensions.map((d) => (d.dimension === dimension ? { ...d, direction } : d)),
    });
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
    if (event.key >= '1' && event.key <= '6') {
      const idx = Number(event.key) - 1;
      selectComposite(COMPOSITE_OPTIONS[idx].option);
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
      <div class="block before-block">
        <h3>ÖNCE</h3>
        <p class="reconstructed-text">
          <span class="ctx">{current.beforeContext}</span>{#if current.beforeContext && current.originalText}{' '}{/if}<span
            class="highlight-before">{current.originalText}</span
          >{#if current.afterContext && current.originalText}{' '}{/if}<span class="ctx">{current.afterContext}</span>
        </p>
      </div>

      <div class="block after-block">
        <h3>SONRA</h3>
        <p class="reconstructed-text">
          <span class="ctx">{current.beforeContext}</span>{#if current.beforeContext && current.finalText}{' '}{/if}<span
            class="highlight-after">{current.finalText}</span
          >{#if current.afterContext && current.finalText}{' '}{/if}<span class="ctx">{current.afterContext}</span>
        </p>
      </div>

      <details class="block technical-block">
        <summary>Teknik edit sınırı</summary>
        <p class="tech-line"><strong>kind:</strong> {current.kind}</p>
        <p class="tech-line"><strong>originalText:</strong> {current.originalText === '' ? '(boş — added edit için geçerli/gerekli)' : current.originalText}</p>
        <p class="tech-line"><strong>finalText:</strong> {current.finalText === '' ? '(boş — removed edit için geçerli/gerekli)' : current.finalText}</p>
        <p class="tech-line"><strong>beforeContext:</strong> {current.beforeContext || '—'}</p>
        <p class="tech-line"><strong>afterContext:</strong> {current.afterContext || '—'}</p>
      </details>

      <div class="block proposal-block">
        <h3>DeepSeek Önerisi</h3>
        <p><strong>{VERDICT_LABELS_TR[current.proposedVerdict]}</strong> ({current.proposedVerdict})</p>
        {#if current.proposedDimensions.length > 0}
          <p class="proposed-dimensions">
            önerilen boyutlar:
            {#each current.proposedDimensions as change, i}{i > 0 ? ', ' : ' '}{DIMENSION_LABELS_TR[change.dimension]} ({DIRECTION_LABELS_TR[change.direction]}){/each}
          </p>
        {/if}
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
            {#each COMPOSITE_OPTIONS as { option, label, key }}
              <button class="verdict-btn" class:selected={currentComposite === option} on:click={() => selectComposite(option)}>
                <span class="key-hint">{key}</span>
                {label}
              </button>
            {/each}
          </div>
          {#if current.humanVerdict === 'no_meaningful_change' && current.humanDimensions.length === 0 && !isReviewed(current)}
            <p class="incomplete-note">"Anlam aynı, ifade/ton değişti" seçildi — devam etmek için en az bir boyut seçin.</p>
          {/if}
          {#if current.humanVerdict !== null && isDisagreement(current)}
            <p class="disagreement-note">
              ⚠ Model önerisi ({VERDICT_LABELS_TR[current.proposedVerdict]}) ile farklı — her iki değer de saklanıyor.
            </p>
          {/if}

          <div class="dimensions-section">
            <h4>NE DEĞİŞTİ?</h4>
            {#each DIMENSION_GROUPS_TR as group}
              <div class="dimension-group">
                <p class="dimension-group-label">{group.label}</p>
                <div class="dimension-grid">
                  {#each group.dimensions as dimension}
                    {@const active = current.humanDimensions.find((d) => d.dimension === dimension)}
                    <div class="dimension-item">
                      <label>
                        <input type="checkbox" checked={Boolean(active)} on:change={() => toggleDimension(dimension)} />
                        {DIMENSION_LABELS_TR[dimension]}
                      </label>
                      {#if active}
                        <select
                          value={active.direction}
                          on:change={(e) => setDimensionDirection(dimension, (e.target as HTMLSelectElement).value as typeof DIRECTION_ORDER[number])}
                        >
                          {#each DIRECTION_ORDER as direction}
                            <option value={direction}>{DIRECTION_LABELS_TR[direction]}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
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

    <p class="hints">Kısayollar: 1-6 karar · X kötü örnek · L lore · ← → önceki/sonraki</p>
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
  .before-block {
    border-left: 4px solid #c0392b;
  }
  .after-block {
    border-left: 4px solid #2a8f4e;
  }
  .reconstructed-text {
    font-size: 20px;
    line-height: 1.7;
    margin: 0;
  }
  .ctx {
    color: #888;
  }
  .highlight-before {
    background: #fbe9e7;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 600;
  }
  .highlight-after {
    background: #e6f4ea;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 600;
  }
  .technical-block {
    background: #f5f5f5;
    font-size: 13px;
  }
  .technical-block summary {
    cursor: pointer;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #777;
  }
  .tech-line {
    margin: 6px 0 0;
    color: #555;
  }
  .proposal-block {
    background: #f0f4f8;
  }
  .proposal-desc {
    margin: 6px 0 0;
    font-size: 15px;
    color: #333;
  }
  .proposed-dimensions {
    margin: 6px 0 0;
    font-size: 13px;
    color: #556;
    font-style: italic;
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
  .incomplete-note {
    margin-top: 10px;
    font-size: 14px;
    color: #a35a00;
  }
  .dimensions-section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #e5e5e5;
  }
  .dimensions-section h4 {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #777;
  }
  .dimension-group {
    margin-bottom: 12px;
  }
  .dimension-group-label {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: #555;
  }
  .dimension-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }
  .dimension-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .dimension-item select {
    font-size: 13px;
    padding: 2px 4px;
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
