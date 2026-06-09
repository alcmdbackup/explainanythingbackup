# Analyze Paragraph Recombine Performance (Latest Runs, DeepSeek) Plan

## Background
Analyze recent paragraph recombine invocation performance on stage using deepseek models. This is an investigation/analysis project focused on understanding how the `paragraph_recombine` agent has actually performed on the staging database for runs whose generation/judge model is a DeepSeek variant.

## Requirements (from GH Issue #NNN)
make sure to look at examples of how it hurt or helped performance, including side by side paragraph comparison. Look at match history and # of matches played

## Problem
We have shipped multiple iterations of `paragraph_recombine` fixes (matchmaking, persistence, cost-undershoot, effectiveness). Prior empirical staging snapshots used gemini + qwen. We do not yet have a focused, evidence-backed picture of how the agent performs **specifically on DeepSeek-model runs** on staging: whether per-slot rewrites actually beat the original paragraph (helped) or lost/drew/got dropped (hurt), how many matches each slot actually played, and what the side-by-side text differences look like. This analysis fills that gap with concrete examples.

## Options Considered
- [ ] **Option A: Pure read-only staging SQL analysis (Recommended)**: Use `npm run query:staging` against `evolution_agent_invocations`, `evolution_arena_comparisons`, `evolution_variants`, `evolution_metrics`, `evolution_runs`/`evolution_strategies` to identify DeepSeek paragraph_recombine runs, then extract cost/quality/match stats and concrete side-by-side paragraph examples. Output is an analysis report in this folder. No code change.
- [ ] **Option B: Admin-UI-driven analysis**: Drive the evolution admin pages (runs / invocations / arena topic leaderboards / variant detail "Diff vs parent") via Playwright to gather the same examples visually. Slower, but produces real UI screenshots of side-by-side diffs.
- [ ] **Option C: Add a reusable analysis script**: Write `evolution/scripts/analyzeParagraphRecombineDeepseek.ts` that codifies the queries for repeatable future analysis. Higher effort; only worthwhile if this becomes a recurring need.

## Phased Execution Plan

### Phase 1: Identify the dataset (which staging runs/invocations qualify)
- [ ] Query `evolution_strategies` for configs where `config->>'generationModel'` or `config->>'judgeModel'` matches a DeepSeek model (e.g. `deepseek-chat`, `deepseek%`).
- [ ] Join to `evolution_runs` (recent, `status='completed'`) → `evolution_agent_invocations WHERE agent_name='paragraph_recombine'`. Record run IDs, strategy IDs, models, created_at, invocation counts.
- [ ] Confirm "recent" window (default: last 14 days on staging; widen if too few DeepSeek runs). Note exact counts so the report has no silent truncation.

### Phase 2: Aggregate performance (cost + quality + matches)
- [ ] Per invocation: pull `cost_usd`, `duration_ms`, `execution_detail.estimationErrorPct`, per-phase `paragraph_rewrite`/`paragraph_rank` cost, per-rewrite `status`/`dropReason`/`temperature`, per-slot `comparisonCount`.
- [ ] Compute drop-rate breakdown by `dropReason` (esp. `length_under` on index-0) for DeepSeek vs the documented gemini/qwen baseline.
- [ ] **Match history & # matches played:** per paragraph slot topic, count rows in `evolution_arena_comparisons` and read `evolution_variants.arena_match_count` / `match_count`; tabulate wins / losses / draws and avg confidence. Flag slots stuck at 0 matches or frozen Elo 1200.
- [ ] Quality outcome: did the recombined article variant beat its parent (`eloAttrDelta` / win vs parent), and did slot winners come from `this_invocation` vs `original` (`winnerSource`)?

### Phase 3: Concrete examples — helped vs hurt (side-by-side)
- [ ] Select representative slots where a rewrite WON over the original (helped): show original paragraph text vs winning rewrite text side-by-side, with match record + confidence.
- [ ] Select slots where the original WON or rewrites were all dropped/drew (hurt / no-op): show side-by-side + the reason (drop, draw, low confidence).
- [ ] Pull these from `evolution_variants.variant_content` (paragraph kind) joined via slot topic; use variant detail "Diff vs parent" semantics for framing.

### Phase 4: Synthesize findings + recommendations
- [ ] Write the analysis report (in `_progress.md` and a findings section here) covering: dataset size, cost profile, drop rates, match-play distribution, help/hurt ratio, and DeepSeek-specific observations (temperature clamping, draw rate, judge behavior).
- [ ] List any follow-up actions (e.g. tune temperature ladder for DeepSeek, adjust length validator, raise/lower per-invocation cap) — as recommendations, not implementation, unless the user asks.

## Testing

### Unit Tests
- [ ] N/A for a pure read-only analysis (Option A). If Option C (analysis script) is chosen: `evolution/scripts/analyzeParagraphRecombineDeepseek.test.ts` — test the query-shaping/aggregation helpers with mocked rows.

### Integration Tests
- [ ] N/A unless Option C adds DB-touching helpers; then a read-only integration test against staging fixtures.

### E2E Tests
- [ ] N/A unless Option B (admin-UI analysis) surfaces a UI bug worth locking with a spec.

### Manual Verification
- [ ] Cross-check at least one slot's claimed match count against both `evolution_arena_comparisons` row count and the persisted `arena_match_count` column (catch the persistence-gap class from `investigate_paragraph_recombine_invocation_20260529`).
- [ ] Sanity-check one invocation's `paragraph_recombine_cost` metric against summed per-slot `spentUsd`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Only if Option B / a UI bug fix: verify the arena slot leaderboard + variant "Diff vs parent" render correct match counts and side-by-side text on a real DeepSeek run.

### B) Automated Tests
- [ ] If any code is added (Option C or a bug fix): `npm run lint && npm run typecheck && npm run build` + the new unit test. Otherwise: no automated tests (analysis-only); run-summary numbers verified manually via `npm run query:staging`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine.md` — add a DeepSeek empirical-data subsection under "Cost envelope" / "Failure modes" if findings differ materially from the gemini/qwen baseline.
- [ ] `docs/docs_overall/debugging.md` — extend the paragraph_recombine drill-down SQL with the DeepSeek-run identification query if it proves reusable.
- [ ] `evolution/docs/rating_and_comparison.md` — note any DeepSeek judge-agreement/draw-rate observation if significant.
- [ ] `evolution/docs/metrics.md`, `evolution/docs/arena.md`, `evolution/docs/cost_optimization.md`, `evolution/docs/data_model.md`, `evolution/docs/multi_iteration_strategies.md` — likely no change; review only.

## Review & Discussion
_This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
