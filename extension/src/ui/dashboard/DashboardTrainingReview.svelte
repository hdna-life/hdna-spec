<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Trial4TrainingCandidate, Trial4ExclusionReason } from '@spec/schema/trial4-training-candidate';
  import type { BehaviorDimension, BehaviorDimensionChange, SemanticChangeVerdict } from '@spec/protocol/semantic-revision-judge';
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
    computeReviewStats,
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

  // Local-only UI mode for the currently-viewed candidate — purely a
  // display toggle between the "valid" and "bad" decision panels, never
  // itself persisted.
  type DecisionMode = 'undecided' | 'valid' | 'bad';
  $: derivedMode = deriveMode(current);
  let modeOverride: DecisionMode | null = null;
  $: mode = modeOverride ?? derivedMode;

  // --- Draft state (Test 1 fix): every button/checkbox below mutates ONLY
  // these local variables, never the store, so nothing the operator marks
  // is taken in or changed until they explicitly press one of the "Kaydet"
  // buttons at the bottom of the decision block. Previously, every click
  // (selectComposite, toggleDimension, toggleExclusionReason, ...)
  // dispatched an immediate `update` — an operator working through the
  // six-option verdict + dimension picker could have a still-incomplete
  // in-progress decision silently committed as includeInTraining/
  // exclusionReasons before they were done marking options. See this
  // block's commitInclude/commitExclude/saveLore functions for the only
  // places that now dispatch `update`.
  let draftHumanVerdict: SemanticChangeVerdict | null = null;
  let draftHumanDimensions: BehaviorDimensionChange[] = [];
  let draftExclusionReasons: Trial4ExclusionReason[] = [];
  let draftOperatorNoteTr = '';
  let draftLoreImportant = false;
  let draftLoreNoteTr: string | null = null;

  $: draftComposite = draftHumanVerdict === null ? null : composeDraftOption(draftHumanVerdict, draftHumanDimensions);

  /** Order-independent set equality over (dimension, direction) pairs — same comparison as trial4-review-state.ts's isDisagreement, applied here against the in-progress DRAFT rather than a saved candidate. */
  function dimensionSetsEqual(a: BehaviorDimensionChange[], b: BehaviorDimensionChange[]): boolean {
    if (a.length !== b.length) return false;
    const aKeys = new Set(a.map((d) => `${d.dimension}:${d.direction}`));
    const bKeys = new Set(b.map((d) => `${d.dimension}:${d.direction}`));
    if (aKeys.size !== bKeys.size) return false;
    for (const key of aKeys) if (!bKeys.has(key)) return false;
    return true;
  }

  $: draftDisagreesWithProposal =
    Boolean(current) &&
    draftHumanVerdict !== null &&
    (draftHumanVerdict !== current!.proposedVerdict || !dimensionSetsEqual(draftHumanDimensions, current!.proposedDimensions));

  function composeDraftOption(
    verdict: SemanticChangeVerdict,
    dimensions: BehaviorDimensionChange[],
  ): Trial4CompositeVerdictOption {
    if (verdict === 'no_meaningful_change') {
      return dimensions.length > 0 ? 'no_meaningful_change_expression_shifted' : 'no_meaningful_change_no_shift';
    }
    return verdict;
  }

  // Reset ALL draft state — including modeOverride — only when the VIEWED
  // CANDIDATE actually changes (by id), never merely because `current`'s
  // object reference changed. The dashboard polls refresh() every 2s
  // (entrypoints/dashboard/App.svelte), which re-fetches candidates from
  // IndexedDB as brand-new object references on every tick even when
  // nothing changed — a naive `$: current?.id, (draft = ...)` re-runs on
  // every such poll (Svelte's reactive statements re-run whenever a
  // *reassigned* dependency is touched, regardless of whether the derived
  // value differs), which would silently wipe in-progress operator marks
  // every ~2s. Comparing against the last-seen id by value fixes this —
  // draft state is seeded from the stored candidate exactly once per
  // candidate view, then left alone until Kaydet or a candidate switch.
  let lastCandidateId: string | undefined;
  $: {
    if (current?.id !== lastCandidateId) {
      lastCandidateId = current?.id;
      modeOverride = null;
      draftHumanVerdict = current?.humanVerdict ?? null;
      draftHumanDimensions = current ? [...current.humanDimensions] : [];
      draftExclusionReasons = current ? [...current.exclusionReasons] : [];
      draftOperatorNoteTr = current?.operatorNoteTr ?? '';
      draftLoreImportant = current?.loreImportant ?? false;
      draftLoreNoteTr = current?.loreNoteTr ?? null;
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

  // Six-option composite verdict UI (Test 1 / v3 addendum) — selecting an
  // option only updates the DRAFT verdict/dimensions; nothing is saved
  // until commitInclude() runs.
  const COMPOSITE_OPTIONS: { option: Trial4CompositeVerdictOption; label: string; key: string }[] = [
    { option: 'meaning_added', label: 'Anlam eklendi', key: '1' },
    { option: 'meaning_removed', label: 'Anlam çıkarıldı', key: '2' },
    { option: 'meaning_transformed', label: 'Anlam dönüştü', key: '3' },
    { option: 'no_meaningful_change_expression_shifted', label: 'Anlam aynı, ifade/ton değişti', key: '4' },
    { option: 'no_meaningful_change_no_shift', label: 'Anlamlı değişiklik yok', key: '5' },
    { option: 'uncertain', label: 'Belirsiz / karar veremiyorum', key: '6' },
  ];

  function selectComposite(option: Trial4CompositeVerdictOption) {
    if (!current) return;
    draftHumanVerdict = verdictForCompositeOption(option);
    if (option === 'no_meaningful_change_no_shift') {
      draftHumanDimensions = [];
    } else if (option === 'uncertain') {
      // "For this first Test 1 pass, keep it simple: uncertain => []."
      draftHumanDimensions = [];
    }
    // meaning_added/meaning_removed/meaning_transformed and
    // "expression_shifted" preserve whatever dimensions are already drafted.
    modeOverride = 'valid';
  }

  function toggleDimension(dimension: BehaviorDimension) {
    const has = draftHumanDimensions.some((d) => d.dimension === dimension);
    draftHumanDimensions = has
      ? draftHumanDimensions.filter((d) => d.dimension !== dimension)
      : [...draftHumanDimensions, { dimension, direction: 'changed' as const }];
  }

  function setDimensionDirection(dimension: BehaviorDimension, direction: (typeof DIRECTION_ORDER)[number]) {
    draftHumanDimensions = draftHumanDimensions.map((d) => (d.dimension === dimension ? { ...d, direction } : d));
  }

  function enterBadMode() {
    modeOverride = 'bad';
  }

  function enterValidMode() {
    modeOverride = 'valid';
  }

  function toggleExclusionReason(reason: (typeof EXCLUSION_REASON_ORDER)[number]) {
    draftExclusionReasons = draftExclusionReasons.includes(reason)
      ? draftExclusionReasons.filter((r) => r !== reason)
      : [...draftExclusionReasons, reason];
  }

  function updateOperatorNote(event: Event) {
    draftOperatorNoteTr = (event.target as HTMLTextAreaElement).value;
  }

  function toggleLore() {
    draftLoreImportant = !draftLoreImportant;
    if (!draftLoreImportant) draftLoreNoteTr = null;
  }

  function updateLoreNote(event: Event) {
    draftLoreNoteTr = (event.target as HTMLTextAreaElement).value;
  }

  // --- Explicit save actions — the ONLY places that dispatch `update`. ---

  $: canSaveInclude = mode === 'valid' && draftHumanVerdict !== null;
  $: canSaveExclude = mode === 'bad' && draftExclusionReasons.length > 0;

  function commitInclude() {
    if (!current || !canSaveInclude) return;
    pushUpdate({
      humanVerdict: draftHumanVerdict,
      humanDimensions: draftHumanDimensions,
      includeInTraining: true,
      exclusionReasons: [],
      operatorNoteTr: draftOperatorNoteTr,
      loreImportant: draftLoreImportant,
      loreNoteTr: draftLoreNoteTr,
      reviewedAt: current.reviewedAt ?? new Date().toISOString(),
    });
    goNext();
  }

  function commitExclude() {
    if (!current || !canSaveExclude) return;
    pushUpdate({
      humanVerdict: null,
      humanDimensions: [],
      includeInTraining: false,
      exclusionReasons: draftExclusionReasons,
      operatorNoteTr: draftOperatorNoteTr,
      loreImportant: draftLoreImportant,
      loreNoteTr: draftLoreNoteTr,
      reviewedAt: current.reviewedAt ?? new Date().toISOString(),
    });
    goNext();
  }

  // Lore is "fully independent" of the include/exclude decision (see
  // spec/schema/trial4-training-candidate.ts) — saveable on its own
  // without requiring a verdict/exclusion decision first, but still only
  // on explicit Kaydet, never on every checkbox click.
  function saveLore() {
    if (!current) return;
    pushUpdate({ loreImportant: draftLoreImportant, loreNoteTr: draftLoreNoteTr });
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
      case 'enter':
        // Explicit save — mirrors the Kaydet buttons, never fires on its
        // own from marking options (1-6/X/L only touch draft state above).
        if (mode === 'valid') commitInclude();
        else if (mode === 'bad') commitExclude();
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
              <button class="verdict-btn" class:selected={draftComposite === option} on:click={() => selectComposite(option)}>
                <span class="key-hint">{key}</span>
                {label}
              </button>
            {/each}
          </div>
          {#if draftDisagreesWithProposal}
            <p class="disagreement-note">
              ⚠ Model önerisi ({VERDICT_LABELS_TR[current.proposedVerdict]}) ile farklı — kaydedince her iki değer de saklanacak.
            </p>
          {/if}

          <div class="dimensions-section">
            <h4>NE DEĞİŞTİ?</h4>
            {#each DIMENSION_GROUPS_TR as group}
              <div class="dimension-group">
                <p class="dimension-group-label">{group.label}</p>
                <div class="dimension-grid">
                  {#each group.dimensions as dimension}
                    {@const active = draftHumanDimensions.find((d) => d.dimension === dimension)}
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

          <div class="save-row">
            <button class="save-btn save-include" on:click={commitInclude} disabled={!canSaveInclude}>
              Eğitimde Kullan (Kaydet)
            </button>
            {#if !canSaveInclude}
              <span class="save-hint">Kaydetmek için önce bir karar seçin (1-6).</span>
            {/if}
          </div>
        {/if}

        {#if mode === 'bad'}
          <div class="reason-grid">
            {#each EXCLUSION_REASON_ORDER as reason}
              <label class="reason-item">
                <input
                  type="checkbox"
                  checked={draftExclusionReasons.includes(reason)}
                  on:change={() => toggleExclusionReason(reason)}
                />
                {EXCLUSION_REASON_LABELS_TR[reason]}
              </label>
            {/each}
          </div>
          <label class="note-field">
            Neden kötü? / Not
            <textarea rows="2" value={draftOperatorNoteTr} on:input={updateOperatorNote}></textarea>
          </label>

          <div class="save-row">
            <button class="save-btn save-exclude" on:click={commitExclude} disabled={!canSaveExclude}>
              Eğitimden Çıkar (Kaydet)
            </button>
            {#if !canSaveExclude}
              <span class="save-hint">Kaydetmek için en az bir neden işaretleyin.</span>
            {/if}
          </div>
        {/if}
      </div>

      <div class="block lore-block">
        <label class="lore-toggle">
          <input type="checkbox" checked={draftLoreImportant} on:change={toggleLore} />
          Lore için önemli (L)
        </label>
        {#if draftLoreImportant}
          <label class="note-field">
            Bu örnek bize ne öğretiyor?
            <textarea rows="3" value={draftLoreNoteTr ?? ''} on:input={updateLoreNote}></textarea>
          </label>
        {/if}
        {#if draftLoreImportant !== current.loreImportant || draftLoreNoteTr !== current.loreNoteTr}
          <div class="save-row">
            <button class="save-btn save-lore" on:click={saveLore}>Lore Notunu Kaydet</button>
          </div>
        {/if}
      </div>
    </article>

    <p class="hints">Kısayollar: 1-6 karar · X kötü örnek · L lore · Enter kaydet · ← → önceki/sonraki</p>
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
  .save-row {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #e5e5e5;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .save-btn {
    padding: 12px 20px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 6px;
    border: none;
    cursor: pointer;
  }
  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .save-include {
    background: #2a8f4e;
    color: #fff;
  }
  .save-exclude {
    background: #c0392b;
    color: #fff;
  }
  .save-lore {
    background: #a35a00;
    color: #fff;
  }
  .save-hint {
    font-size: 13px;
    color: #888;
  }
  .hints {
    margin-top: 16px;
    font-size: 13px;
    color: #888;
    text-align: center;
  }
</style>
