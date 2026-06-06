# Create Tool Systematic Judge Evaluation (Evolution) Plan

## Background
Create a new tool that helps systematically evaluate judge performance. The "judge" is the LLM that performs pairwise (A/B/TIE) comparisons of text variants in the evolution arena, producing winner verdicts and confidence/decisiveness scores that drive the Elo ratings. Today judge quality is studied ad-hoc; there's no repeatable tool to log match history, record the exact judge settings used, and measure whether custom prompt / temperature / added reasoning improves the decisiveness rate. This project builds that tool, storing results in a structured, retrievable way (keyed by judge settings) and replicating the methodology of the historical judge analyses already done in this repo and on GitHub.

## Requirements (from GH Issue #1167)
- Keep logs of match history
- Record settings used
- Test out if custom prompt/temperature/adding reasoning improves decisiveness rate
- Figure out how to store results in a structured way for later retrieval, including judging settings used
- Look at historical judge analysis, and see what we can learn from the methodology there
- How should this interact with match viewer and prompt modifier?
    - OK if this is adhoc
- Base this on the past judge analyses that have been done. Look at Github to find the historical records of the judge analyses that were done and try to replicate the methodology.

## Problem
_(refine after /research)_ Judge decisiveness directly affects ranking signal: low-confidence/TIE-heavy verdicts mean matches don't move Elo, wasting LLM spend and slowing convergence. There is no repeatable harness to (a) run a fixed bank of A/B pairs through the judge under varying settings (model, temperature, custom prompt, reasoning on/off), (b) log every match + the exact settings used, and (c) compare decisiveness/agreement across settings to pick a better default. The two existing research docs were produced ad-hoc; we need to recover that methodology from GitHub and turn it into a reusable tool with structured, retrievable storage.

## Options Considered
- [ ] **Option A: Standalone CLI/script harness** (e.g. `evolution/scripts/judgeEval.ts`): Sweeps a fixed pair-bank × settings matrix, calls the existing `compareWithBiasMitigation` (extended to accept prompt/temperature/reasoning overrides), writes structured results to a new table or JSON artifacts. Mirrors how the historical analyses were likely run. Lowest UI surface; fastest to land.
- [ ] **Option B: Admin UI tool** under `/admin/evolution/` (a "Judge Lab" page): Pick pairs from the match viewer, configure judge settings via the prompt modifier, run, and see decisiveness/agreement dashboards. Highest discoverability; most build cost; ties directly into match viewer + prompt modifier.
- [ ] **Option C: Hybrid (Recommended pending /research)**: Core eval engine + structured storage as a script/service (Option A), plus a thin ad-hoc admin surface that reuses the existing match viewer (to pick pairs) and prompt modifier (to set the judge prompt), wiring results into a results view. Matches the requirement that match-viewer / prompt-modifier interaction is "OK if ad-hoc."

## Phased Execution Plan

### Phase 0: Research & Methodology Recovery (precedes coding — run /research)
- [ ] Read `docs/research/judge_agreement_summary_tables.md` + `docs/research/judging_accuracy_20260412.md` and extract the exact experimental design (pair bank, settings swept, metrics computed, ground-truth source).
- [ ] Search GitHub (PRs, issues, merged branches, `evolution/scripts/`) for the original judge-analysis scripts/records that produced those docs; document where they live and how they were run.
- [ ] Read judge code paths (`comparison.ts`, `reversalComparison.ts`, `computeRatings.ts`, `rating.ts`, `comparisonCache.ts`, `arenaActions.ts`) and confirm where prompt/temperature/reasoning overrides must be threaded.
- [ ] Identify the actual "match viewer" and "prompt modifier" surfaces and define the ad-hoc integration contract.
- [ ] Decide Option A/B/C and the storage shape (new table vs JSONB vs artifact files) — settle the "structured, retrievable, keyed by judge settings" requirement.

### Phase 1: [Eval engine + settings override] _(refine after /research)_
- [ ] Thread judge-setting overrides (custom prompt, temperature, reasoning effort) through the comparison primitive without changing default behavior for the live pipeline.
- [ ] Build a fixed pair-bank loader (known A/B pairs, optionally with ground-truth labels).

### Phase 2: [Structured logging + storage] _(refine after /research)_
- [ ] Define structured result schema (match history + judge settings + decisiveness/agreement metrics) and persistence path.
- [ ] Implement retrieval (query results by judge settings).

### Phase 3: [Sweep runner + metrics] _(refine after /research)_
- [ ] Sweep model × temperature × prompt × reasoning; compute decisiveness rate, agreement vs ground-truth, position-bias residual.
- [ ] Replicate the historical summary tables as output.

### Phase 4: [Ad-hoc match-viewer / prompt-modifier integration] _(refine after /research)_
- [ ] Wire pair selection from the match viewer and prompt configuration from the prompt modifier into the tool (ad-hoc acceptable).

## Testing

### Unit Tests
- [ ] _(define after /research)_ e.g. `evolution/src/lib/<judgeEval>.test.ts` — settings-override threading, decisiveness-rate computation, agreement metric.

### Integration Tests
- [ ] _(define after /research)_ e.g. results persistence + retrieval-by-settings against real Supabase (if a new table is added).

### E2E Tests
- [ ] _(define after /research; only if an admin UI surface is built)_ — Judge Lab page run flow.

### Manual Verification
- [ ] Run the eval harness on a small pair-bank against a cheap judge model and confirm logged match history + settings + decisiveness metrics match hand-computed values.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] _(only if Option B/C adds UI)_ — verify Judge Lab page on local server via ensure-server.sh.

### B) Automated Tests
- [ ] _(define after /research)_ e.g. `npm run test:unit -- --grep "judgeEval"` and integration suite for storage.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/rating_and_comparison.md` — if comparison primitive gains settings overrides / new decisiveness tooling.
- [ ] `evolution/docs/arena.md` — if match-viewer integration or new comparison storage is added.
- [ ] `evolution/docs/data_model.md` — if a new results table / columns are added.
- [ ] `evolution/docs/metrics.md` — if decisiveness/agreement become tracked metrics.
- [ ] `evolution/docs/logging.md` — if per-match judge-eval logging is added.
- [ ] `evolution/docs/visualization.md` + `docs/feature_deep_dives/admin_panel.md` — if an admin UI tool is added.
- [ ] `evolution/docs/strategies_and_experiments.md` — if judge settings (temperature/reasoning) become first-class config.
- [ ] `docs/research/judge_agreement_summary_tables.md` / `docs/research/judging_accuracy_20260412.md` — extend/cross-link with the new repeatable tool.

## Review & Discussion
_(populated by /plan-review)_
