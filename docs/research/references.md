# Academic Reference Notebook (condensed)

Condensed from `hdna-design-research-document.md`'s "Akademik Referans
Defteri" and "Academic Validation and Contradictory Evidence Rule" sections.
None of this PR's code depends on any EXPERIMENTAL/PROMISING claim below —
it's recorded here so future work that touches evidence classification,
retrieval, or expression transform can find the sourcing without re-reading
the full source document.

Evidence status values: `ESTABLISHED`, `SUPPORTED`, `PROMISING`,
`EXPERIMENTAL`, `REJECTED`. See source doc §"Evidence status" for definitions.

| Claim | Status | Source(s) |
|---|---|---|
| Character n-grams, punctuation, lexical/function-word distributions are useful recurring writing-behavior signals | SUPPORTED | Stylometry/authorship-attribution survey, Information 2024, 15(3), 131 |
| Keystroke dynamics carry person-specific behavioral evidence | PROMISING / secondary evidence | Keystroke Dynamics Systematic Review, 2024 |
| AI-suggestion -> human-edit pairs are useful personalization evidence | SUPPORTED | PePe (EACL 2023 Findings); ACL 2026 post-editing study |
| A single authorship embedding can represent canonical persona | REJECTED | Authorship Embeddings — What Information Do They Encode? (TACL 2023) |
| Evidence -> pattern -> trait hierarchical representation is a reasonable persona architecture | SUPPORTED / PROMISING | PersonaTree (2026); Setoka (2026); PGMem (2026) |
| Sub-billion-parameter models can be sufficient for persona expression transfer | PROMISING / EXPERIMENTAL | TinyStyler (EMNLP 2024 Findings) |
| Query-focused (task-relevant) persona retrieval beats dumping full persona context | PROMISING | Query-Focused Individual Simulation (ACL Findings 2026) |
| Persona conditioning can be injected into a frontier model's reasoning without affecting task capability | REJECTED as an assumption | General persona-induction literature; motivates keeping HDNA transform downstream of frontier reasoning, not upstream |
| Persona/user representation should change at different rates for different properties | SUPPORTED | DynamicMem (2026); PERSONAMEM (2025) |
| Structured/graph representation is preferable to vector-only storage for multimodal personal memory | SUPPORTED | MobileMem (2026) |
| Voice/speaker identity should be separated from speaking style/prosody | SUPPORTED | Voicing Personas (2025); CapTalk (2026); VoxCPM2 (2026) |

## Phase 5A additions (`docs/decisions/0016`)

Added for the Phase 5A semantic-delta-extraction experiment. Per this
notebook's own rule (below), each entry separates what the paper actually
supports from HDNA's own hypothesis built on top of it — see `docs/decisions/0016`
for the full three-part (bibliographic fact / what's supported / HDNA
inference) treatment of each. None of these are claimed to prove HDNA's
architecture works.

| Claim | Status | Source(s) |
|---|---|---|
| Historical text edits carry a human preference signal | SUPPORTED (for the narrow claim; does not extend to persona-construction from edits) | EditPrefs — Majkutewicz & Szymański, *Knowledge-Based Systems* 322 (2025), 113566, DOI 10.1016/j.knosys.2025.113566 |
| Understanding *why* users prefer a response (inferred persona), not just *what* was preferred, can improve preference-tuning personalization | PROMISING | Balepur et al., ACL 2025, DOI 10.18653/v1/2025.acl-long.168 |
| Preserving meaningful user-specific preference *differences* (vs. collapsing into generic aggregates) improves LLM personalization | PROMISING | "Measuring What Makes You Unique," Findings of ACL 2025, DOI 10.18653/v1/2025.findings-acl.1095 |
| Broader user-history representations capture habits/preferences isolated retrieval may miss, improving personalized generation | PROMISING | Persona-Plug, ACL 2025, DOI 10.18653/v1/2025.acl-long.461 |

**HDNA hypothesis under test (Phase 5A, not proven by any of the above):**
AI-output → human-edit transformations can be converted into explicit,
grounded, provenance-linked semantic evidence useful for constructing an
individual persona. See `docs/decisions/0016` for the full framing and the
pre-declared, human-graded acceptance criteria this hypothesis will actually
be judged against.

## Phase 5A Trial 1/2 additions (`docs/decisions/0016`)

Added for Trial 1 (transformation-grounding) and Trial 2 (deterministic
evidence localization). The baseline extractor's groundedness shortfall
(66.7% vs. required ≥80%, confirmed unchanged by Trial 1's real result —
see `docs/decisions/0016`) was traced to two related problems: the
extractor attributing to the human edit meaning already present in the
AI-drafted source, and insufficient localization of exactly which source
material changed. Trial 1 grounds extraction explicitly in the ORIGINAL →
FINAL transformation; Trial 2 adds a deterministic, published-method-based
localization layer ahead of semantic interpretation. Same discipline as
above: each entry separates what the paper actually supports from HDNA's
own hypothesis; none of these are claimed to prove HDNA's Trial 1/2
changes work, only that they have real (and, for Conijn et al., direct
algorithmic) research grounding.

| Claim | Status | Source(s) |
|---|---|---|
| Surface/meaning-preserving revisions can be distinguished from meaning-changing revisions; revision operations (insertion, deletion, substitution, reordering) can be automatically classified via restricted Damerau-Levenshtein distance below word level | SUPPORTED — **directly implemented** (not just thematic motivation): Trial 2's `computeRevisionDiff` (`extension/src/persona/revision-diff.ts`) is a word/token-level adaptation of this exact method, including the reordering class | Conijn, Kleinberg & van den Bosch, "A Product- and Process-Oriented Tagset for Revisions in Writing" (2022) |
| Human-edit/document-revision alignment across versions is a real, tractable alignment problem worth solving explicitly, at multilingual/document scale | SUPPORTED (as a related-work data point) — **reviewed, not adopted**: NewsEdits' article/history-scale alignment does not fit HDNA's single two-version, sentence/short-paragraph `EditEvent` pairs; see `docs/decisions/0016`'s Trial 2 "Deterministic diff/alignment algorithm chosen" for why Conijn et al.'s smaller, word-level method was chosen instead | Spangher et al., NewsEdits |
| Research on text revision increasingly studies not only *what* changed but the semantic purpose/intention of the change | PROMISING / neighboring motivation | Lan, Zhang & Dragut, "Making Revisions Understandable," ACL Findings 2026 |
| Human edits can themselves form a meaningful linguistic/discourse data source, rather than being treated merely as noise around a final text | SUPPORTED (as general motivation for treating edits as evidence-bearing) | WikiAtomicEdits (large-scale human-edit data) |
| Linguistic form can encode semantic/pragmatic properties such as modality, factuality, speaker commitment, and conditionality, and these properties may change even when the surface edit is small | SUPPORTED | Cross-linguistic/formal-semantics and NLP literature on modality, factuality, speaker commitment, and conditionality (reviewed generally; no language-specific extraction rule adopted from it — see `docs/decisions/0016`'s Trial 1 section) |

**What these do NOT establish:** none of the above validates HDNA's
specific counterfactual-grounding instruction, proves Trial 1 or Trial 2
will clear the groundedness threshold, or supports any claim of the form
"a modality/commitment/conditionality change constitutes a personality
change" — the supported claim is narrower and purely linguistic (form can
encode these properties, and they can shift under a small surface edit),
not psychological. Conijn et al. classifying revisions in writing
generally does not establish that this classification is the right or
optimal basis for *persona-relevant evidence localization* specifically —
that connection is HDNA's own hypothesis, not the cited paper's claim.
Whether Trial 1's prompt revision, or Trial 2's added localization layer,
actually improves groundedness on HDNA's real corpus remains an open,
to-be-measured question — see `docs/decisions/0016`'s Trial 1 and Trial 2
sections for status.

## Phase 5A Trial 3 additions (`docs/decisions/0016`)

Added for Trial 3, which redesigns the extractor around a much smaller,
WebGPU-scale-proxy model (`qwen/qwen3-1.7b`) judging one deterministically
localized intervention at a time, with an explicit `'uncertain'` abstention
verdict distinct from `'no_meaningful_change'`.

| Claim | Status | Source(s) |
|---|---|---|
| A classifier can be given, and can meaningfully use, an explicit "abstain/reject" option rather than being forced to output a class for every input, trading coverage for reduced error rate on what it does answer | SUPPORTED — general motivation for Trial 3's `'uncertain'` verdict as a first-class outcome distinct from `'no_meaningful_change'` | Chow, "On Optimum Recognition Error and Reject Tradeoff," IEEE Trans. Information Theory (1970) — the foundational reject-option/selective-classification result |
| Selective classification (predict-or-abstain) has a formal foundation and known coverage/risk tradeoff properties, independent of model architecture | SUPPORTED (as general motivation) | El-Yaniv & Wiener, "On the Foundations of Noise-Free Selective Classification," JMLR (2010) |

**What these do NOT establish:** neither source is about semantic revision
judgment, persona evidence, or LLMs specifically — both are general
classification-theory results from decades before LLM-based structured
output existed. They support only the narrow claim that giving a
classifier (here, the small judge model) a legitimate "I don't know"
output is a well-founded design choice, not evidence that Trial 3's
specific narrow prompt, `SemanticRevisionJudgmentDraft` schema, or
deterministic admission gate improves groundedness on HDNA's real corpus —
that remains open and unmeasured until the real operator run (see
`docs/decisions/0016`'s Trial 3 section and
`docs/validation/manual-mvp-validation.md`'s Trial 3 subsection). Trial 3's
deterministic localization layer itself makes no new claim beyond what
Trial 2's Conijn et al. grounding already establishes above —
`revision-intervention.ts` only filters/repackages `RevisionDiff` output,
it does not change the underlying alignment algorithm.

## Rule this notebook must be maintained under

Per the source doc: a paper supporting an existing HDNA hypothesis must be
treated with the same skepticism as one contradicting it. When adding a row,
also record (in the fuller entry, if one is written under
`docs/decisions/` or a future `docs/research/` deep-dive) contradicting
evidence, author-stated limitations, and domain fit — not just the supporting
citation. See source doc §"Academic Validation and Contradictory Evidence
Rule" for the full required format.
