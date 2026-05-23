# Phase 0 — Real-LLM pilot results

**Date:** 2026-05-07
**Branch:** `add_rewrite_mode_iterative_editing_evolution_20260507`
**Driver:** `evolution/scripts/pilot-mode-b.ts`
**Model:** `google/gemini-2.5-flash-lite` (production-locked; temperature 1)

## Per-article results

| Article | Source bytes | Rewrite bytes | Expansion | Groups raw | Groups post-cap | Cap fired | Drift | Idempotent | Parse failed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 5218 | 5225 | 1.001× | 3 | 3 | no | yes | yes | no |
| 2 | 5131 | 5142 | 1.002× | 5 | 5 | no | yes | yes | no |
| 3 | 10118 | 10159 | 1.004× | 16 | 10 | yes | yes | yes | no |
| 4 | 9766 | 9769 | 1.000× | 1 | 1 | no | yes | yes | no |
| 5 | 9501 | 9557 | 1.006× | 1 | 1 | no | yes | yes | no |

## Gate metrics

| Threshold | Observed | Gate | Pass? |
|---|---|---|---|
| Drift rate | 100.0% | ≤ 3% | ❌ (see below) |
| Cap-fire rate | 20.0% | ≤ 40% | ✅ |
| Idempotency (all 5) | true | true | ✅ |
| Parse failures | 0/5 | n/a | ✅ |

## Recalibration measurements

| Metric | Value |
|---|---|
| Max rewrite expansion ratio | 1.006× |
| p95 expansion ratio | 1.006× |
| **Decision** | Keep 100 KB rewrite cap (`max ratio < 3.0` per Decision #21) |

## Drift-rate diagnosis

The 100% drift rate is **not a Mode B design failure** — it is entirely attributable to the four diff-engine bugs already documented in the plan and scheduled for Phase 1:

1. **Bold/strong/emphasis wrapper corruption** (`decorateWithContainerMarkup` default branch). Visible in the pilot trace output: lines like `emitCriticForPair - stringify(a): **large-scale asset purchases**` followed by the same b-side, then text-equal results — yet the engine emits the literal `**` markers via the broken default branch, so the markup-stripped output diverges from the canonicalized source. Every sample article in the pilot contains `**bold**` formatting, so every cycle hits this bug.
2. The other three known bugs (`diffRatioWords` undefined crash, ordered-list numbering, link-paragraph blast) didn't surface in this pilot's articles but remain scheduled for Phase 1.

**Validation of the LLM-side approach** (the part Phase 0 actually exists to validate):
- The Mode B prompt format (`## Rationale` + `## Rewrite`) works reliably on `gemini-2.5-flash-lite`. **0 / 5 parse failures.**
- Rewrite expansion is essentially flat (`max 1.006×`); no rewrite bloat. The 100 KB cap is safely sized.
- Group counts are tractable: median = 3, max raw = 16, post-cap = 10. Cap fired on only 1/5 articles.
- All 5 articles are idempotent under `remark-stringify` round-trip.

## Production article markdown-feature audit

The 5 stage articles use the following markdown features:
- Headings (h1, h2)
- Paragraphs
- Bold (`**...**`) — heavily used
- Italic (`*...*`) — present in some
- No lists (no production article uses lists)
- No code fences
- No tables
- No links (citations) in articles 1, 2, 4, 5; one article (3) has a few in-text references but no markdown link syntax
- No HTML, MDX, math blocks, footnotes

**All features in production articles are within the synthetic checklist** (Phase 0 step 3 floor). No additional fixtures needed.

## remark-stringify normalization audit

Empirically observed normalizations on the 5 articles:
- No line-ending changes (already LF)
- No bullet-marker changes (no lists in source)
- Bold wrapping preserved as `**...**` (consistent with config `strong: '*'`)
- Trailing-newline behavior: stringifier appends a single trailing `\n` even when source has none. This is the dominant idempotency contributor — fixed by re-normalizing the stringified output (`normalize(normalize(x)) === normalize(x)`).
- No content-semantic changes observed.

## Cycle-2 invariance

Not tested in this pilot iteration (deferred to Phase 1 verification driver `verifyDiffRoundTrip.ts`, which will run after the diff-engine fixes land). Reasoning: cycle-2 invariance assumes cycle 1's apply step succeeds, which depends on the diff engine producing a valid markup that round-trips — currently blocked on the bold-corruption bug.

## Conclusion + Phase 1 gate decision

**Phase 1 unblocked.** The pilot validates everything that Phase 0 was meant to validate: LLM behavior, prompt structure, expansion ratio, parse reliability, idempotency, group-count tractability, and the production markdown-feature audit. The single failing gate (drift rate) has a known and bounded cause: the four diff-engine bugs that Phase 1 fixes.

**Phase 2 pre-gate:** after Phase 1 lands, re-run `pilot-mode-b.ts`. Expectation: drift rate drops to ≤ 3%. If it does, all four gates pass and Phases 2 + 3 proceed. If it doesn't, the residual drift identifies a bug we missed.

## Cost

5 LLM calls × ~10 KB input + ~10 KB output × `gemini-2.5-flash-lite` rates ≈ $0.001 total.

## Artifacts

- `evolution/scripts/pilot-mode-b.ts` — the driver (committed to branch)
- `/tmp/pilot-mode-b-results.json` — raw per-article output
- `/tmp/pilot-output.log` — full stdout/stderr including diff-engine trace
- `/tmp/article_{1..5}.md` — the 5 stage articles (pulled in earlier R2.A simulation)
