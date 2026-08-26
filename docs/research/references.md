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

## Rule this notebook must be maintained under

Per the source doc: a paper supporting an existing HDNA hypothesis must be
treated with the same skepticism as one contradicting it. When adding a row,
also record (in the fuller entry, if one is written under
`docs/decisions/` or a future `docs/research/` deep-dive) contradicting
evidence, author-stated limitations, and domain fit — not just the supporting
citation. See source doc §"Academic Validation and Contradictory Evidence
Rule" for the full required format.
