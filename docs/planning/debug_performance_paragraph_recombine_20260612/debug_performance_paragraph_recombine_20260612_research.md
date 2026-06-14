// Research summary for debug_performance_paragraph_recombine_20260612.

# Research summary

A prior 4-round × 5-agent investigation (preserved at `~/Documents/ac/option_b_reference_20260614/planning/`) identified two structural failures in today's `paragraph_recombine`:

**Problem 1 — Voice fingerprint loss.** Each per-slot rewriter is blind to the parent's voice (register, sentence-length distribution, contraction usage). At temperatures ≥1.2 the LLM defaults to its house Latinate register. When ≥6 slots get rewritten, the article either gets a tonal seam between kept-original front and rewritten back (R2A worst case: Latinate ratio 0.20 → 0.59 in the back half) or carpet-bombed Latinate inflation throughout. The article-level judge punishes this decisively.

**Problem 2 — Frankenstein coordination.** Per-slot rewrites are dispatched in parallel; each slot is blind to its siblings. Each add-example directive independently picks a metaphor; the per-slot judge correctly rewards the with-analogy rewrite in isolation. Aggregated across slots: 4–6 stacked cross-domain analogies (ship-captain + gardener + firefighter + conductor), duplicated acronym definitions, register seams. Both judges are working as intended — the architecture lacks a coordination layer.

## Quantitative baseline (30-day staging)

- 56 paragraph_recombine invocations spent $0.518 to LOSE 42 mu of aggregate Elo.
- structural_transform spent $1.64 to GAIN 1,221 mu (770× cost-efficiency gap).
- Output-style attractor at parent_mu ≈ 27: paragraph_recombine LIFTS weak parents (+5.17 mean on parent_mu < 20) but DRAGS strong parents (−2.93 mean on parent_mu ≥ 30).
- 72.7% of articles have ≥3 distinct cross-domain analogy domains.
- 73% of articles duplicate an acronym definition.
- 89% of winning rewrites are longer than the original; median +96 chars per slot.

## R2A reference case (the worst-degraded variant)

`49913773-...` (Elo 1123, parent Elo 1319). Latinate ratio 0.20 (parent) → 0.59 (regressed child). 3 distinct stacked metaphor domains. Lost to opponent `a4c4fc15-...` at Elo 1279 (39 Elo BELOW the parent) — proves the failure is design-specific, not "parent too strong to improve". Fixtures committed at `evolution/src/testing/fixtures/voice/` (preserved at `~/Documents/ac/option_b_reference_20260614/fixtures/`).

## Preserved reference

Full research findings (R1A–R4E, ~360 lines) live at `~/Documents/ac/option_b_reference_20260614/planning/debug_performance_paragraph_recombine_20260612_research.md`. This file is the executive summary; consult the preserved archive for the full SQL queries, sub-agent findings, and opponent-analysis design vocabulary.
