# Groups Of Judges Make Up Indecisiveness Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/groups_of_judges_make_up_indecisiveness_evolution_20260611` off `origin/main`.
- Read core workflow + operations docs (7) and judge/evolution docs (judge_evaluation, rating_and_comparison, criteria_agents in full; arena, cost_optimization, agents/overview, metrics, data_model, llm_provider_limits surveyed).
- Surveyed `evolution/src/` judge/comparison code and confirmed Judge Lab infrastructure exists (read-only batch measurement; no production ensemble/voting yet).
- Populated research + planning skeletons with findings and 5 candidate options (A–E).

### Issues Encountered
[none yet]

### User Clarifications
[none yet]

## Research (Step 1) — DONE
### Work Done
- Mapped Judge Lab code (Explore agent) + ran subagent brainstorm of 8 ensemble/aggregation strategies.
- Queried dev DB (123 runs / 12,580 calls / 11 test sets) and ran offline ensemble simulations on real recorded verdicts.
- Key findings (full detail in research doc):
  - Paragraph indecisiveness = bimodal, ~51% forced-TIE position bias; **deterministic** (40/40 splits) so repeats/self-consistency are useless; stronger models are LESS decisive on paragraphs.
  - Cross-MODEL cheap panels DO help paragraphs (62% of pairs have ≥2 cheap models agreeing decisively) and ARTICLES (3-cheap panel 0.83 decisive @ 0.857 acc — more accurate than single gpt-4.1).
  - Diminishing returns past K=3; adding strong models hurt article accuracy.
  - Most strategies validate OFFLINE for ~$0 by re-aggregating existing calls.
- Updated research doc (Findings 1–6, approaches evaluated, caveats, extension points) and planning Options (E first, B core, A articles-only, C rejected).

### Issues Encountered
- GitHub issue creation blocked by permission classifier during /initialize (docs keep `#NNN` placeholder).

### User Clarifications
[none yet]

## Design: Match-history submatch UX wireframes (2026-06-13)
Detail-page chain layout = **timeline cards** (chosen; table / table+side-panel rejected).

List view — new "Escalation" column (chain depth + outcome / decided-by). Rule = first_decisive
(stop on first decisive vote; TIE only if all abstain):
```
Pair  Matchup            Winner Conf  Escalation              Cost
#014  V.a91… vs V.c20…     A    1.00  ●     1 · judge 1        $.0002   judge 1 decisive
#015  V.77f… vs V.b03…     B    1.00  ●●    2 · judge 2        $.0004   1 abstain → judge 2 decided
#016  V.4d1… vs V.e88…     A    1.00  ●●●   3 · judge 3        $.0011   2 ties → judge 3 decided
#018  V.1c7… vs V.9aa…    TIE   —     ●●●   3 · all abstained  $.0012   no decisive vote → TIE
#017  V.a02… vs V.f51…     A    0.70  —     single (legacy)    $.0003   pre-feature
```

Detail page — escalation timeline (cards, expand inline). Example #016 = "two ties + one decisive":
```
Match #016 · paragraph
Consolidated: A  conf 1.00 · rule first_decisive@v1
Chain depth 3 · votes A=1 B=0 abstain=2 · decided by judge 3 · $0.0011 · 82ms

Escalation chain
① deepseek-v4-flash  TIE 0.50  abstained          → escalate     ▸
② gpt-4.1-nano       TIE 0.50  abstained          → escalate     ▸
③ qwen-2.5-7b        A   1.00  decisive           → RESOLVED ✓   ▸
Σ  votes A=1 B=0 abstain=2 → decisive A @ 1.00 (lone decisive vote accepted)
[ Re-judge entire chain ]  [ Open in arena Match Viewer ]
```

Submatch expanded — rubric mode (favored_match_winner = "Backed winner?"):
```
② gpt-4o-mini (rubric: editorial-v2)  A  1.00  ▾
 Dimension   Weight Fwd Rev Winner Backed winner?
 clarity      0.40   A   A    A       ✓
 depth        0.25   A   B   TIE      –
 structure    0.25   A   A    A       ✓
 engagement   0.10  TIE  A    A       ✓
 Pass scores: fwd A=1.00/B=0  rev A=0.75/B=0.25 → A
```
Legacy / chain-of-1 renders as a single card, no escalation banner.

## Phase 1: Aggregation framework + offline validation — DONE (code) / GATE (decision)
### Work Done
- Built `evolution/src/lib/shared/judgeEnsemble/`: `types.ts` (SubVerdict/ConsolidatedVerdict + isDecisiveVote/tally), `aggregation.ts` (first_decisive default + unanimous_among_decisive + confidence_weighted, versioned registry, fails closed), `planner.ts` (pure escalation replay), `offlineReaggregate.ts` (simulator + metrics). 32 unit tests; typecheck + eslint clean.
- Exported the pinned validation corpus to `fixtures/recordedCorpus.json` (470 rows: 270 article / 9 models, 200 paragraph / 4 models) via `evolution/scripts/buildJudgeEnsembleFixture.ts`. Analysis runner: `evolution/scripts/runJudgeEnsembleOffline.ts`.
- **Finalized chains (data-driven, in `CHAINS`):**
  - Article: `[gpt-4o-mini, deepseek-chat]` — two cheap, NO strong tier (adding gpt-4.1 hurt accuracy 1.000→0.778).
  - Paragraph: `[gemini-2.5-flash-lite, deepseek-v4-flash, gemini-2.5-flash]` — accurate-cheap first, NO deepseek-v4-pro (decisive-but-wrong on paragraphs, acc 0.200).

### Offline acceptance-gate results (first_decisive)
| Mode | chain decisive | best single cheap | large-gap accuracy | lone-decisive-wrong | $/decisive (chain vs strong) | avg depth |
|---|---|---|---|---|---|---|
| Article (n=30, LG=9) | **0.833** | 0.60 | **1.000** | **0.000** | 0.00127 vs 0.01271 | 1.40 |
| Paragraph (n=50, LG=20) | **0.740** | 0.60 | 0.765 | 0.235 | 0.00053 vs (strong worse) | 1.72 |

Bars: decisiveness uplift (≥+0.10) ✓ both; accuracy (≥strong−0.03) ✓ both; cost (≤single-strong) ✓ both.
Lone-decisive-wrong (<0.10): **article PASS (0.000)**; **paragraph FAIL (0.235)** — BUT large-gap n=9/n=20 is underpowered (gate's own statistical-power note: widen to ≥50/mode). The paragraph lone-wrong reflects the cheap judges' inherent ~0.21–0.25 error on the tiny labeled subset, not a chain defect; unanimous_among_decisive restores accuracy (1.000) but collapses decisiveness to ~0.22–0.30.

### Verdict → HUMAN GO/NO-GO (the gate)
Articles clear all bars cleanly and are production-promising. Paragraphs clear decisiveness/accuracy/cost but the lone-decisive-safety bar cannot be trusted at n=20 — needs the corpus widened to ≥50/mode large-gap before the gate is decisive. Per plan, do NOT start Phase 4 prod wiring on the paragraph default until that's resolved (or set the paragraph default to unanimous_among_decisive).

### Issues Encountered
- Initial chains were mis-ordered/mis-composed (deepseek-v4-pro 3rd on paragraphs; strong gpt-4.1 hurt article accuracy). Re-ordered (accurate-cheap first) + dropped strong tiers → fixed.

## Phase 2: Live escalation as a Judge Lab sweep — IN PROGRESS (articles; user go-ahead 2026-06-13)
### Work Done
- **Escalation evaluator** `evolution/src/lib/judgeEval/escalation.ts`: `evaluatePairWithEscalation` runs the sequential chain over an injected `makeJudge(model)=>JudgeFn`, capturing per-submatch audit (cost/raw/tokens/per-pass winners) at parity with judge_eval_calls. Stop-on-resolve / escalate-on-abstain / cap; transient failure = abstention (escalate); fatal budget/kill error propagates. 7 unit tests (fake judge, no LLM/DB); typecheck+eslint clean.
- **Migration** `supabase/migrations/20260613000001_judge_eval_escalation.sql` (additive, idempotent): submatch cols on `judge_eval_calls` (`submatch_group_key`, `escalation_step`, `triggered_escalation`, `judge_model`) + indexes; `judge_eval_chains` config table (deny-all RLS + service_role_all); `chain_id`/`aggregation_rule(_version)` on `judge_eval_runs`. Legacy single-judge rows keep NULL submatch cols.

### Done (pure logic, tested)
- [x] **Escalation-aware cost gate + chain settings key** (`settings.ts`): `plannedCalls(...,chainCap)` worst-case; `assertWithinJudgeEvalCap` gates on worst case (chainCap=1 byte-identical); `buildEscalationSettingsKey` (chain+rule+version+cap, never collides with single-judge). 9 tests + existing settings regression green.

### Phase 2 DB glue — DONE (after PR #1213 merged + migration deployed to staging)
- [x] Regenerated `database.types.ts` for the merged migration (surgical add in main's format — avoids CLI-version reformat churn). Done after authenticating Supabase + `npm run db:types`.
- [x] **Persistence mapping** `escalationPersist.ts`: `submatchToCallRow` (pure) + `upsertEscalationRun` (chain_id/aggregation_rule, escalation settings_key) + `replaceEscalationCalls`. 5 unit tests.
- [x] **Sweep orchestration** `executeEscalationSweep.ts`: `runEscalationOverPairs` (pure mode-aware per-pair chain run over injected makeJudge) + `executeEscalationSweep` (load pairs -> worst-case cost gate via chainCap -> insert chain + upsert run -> createCallLLMJudge per model -> persist submatch rows). 3 unit tests.
- Full Phase-2 code path now implemented + unit-tested (53 tests, 7 suites). Typecheck + eslint clean.

### Phase 2 entry points + UI + viewing — DONE
- [x] CLI `escalation-sweep` (`judge-eval.ts`) with inline match-level summary; server action `createEscalationSweepAction` (admin, cap-gated).
- [x] Leaderboard VIEW (`20260614000001`): UNION single-judge (per-call) + escalation (per-match by submatch_group_key; consolidated = final submatch).
- [x] **Constraint fix** (`20260614000002`): the live sweep surfaced `judge_eval_calls UNIQUE(run,pair,repeat)` blocking multi-submatch matches; replaced with partial unique indexes (single-judge keeps it; escalation unique per (run,pair,repeat,escalation_step)).
- [x] Admin UI: single/escalation mode toggle + escalation launcher (article/paragraph chains, rule, cap) in `judge-lab/page.tsx`; leaderboard auto-works.
- [x] Integration test (multi-submatch persistence + leaderboard; auto-skips until migrations deploy) + E2E (escalation mode toggle renders launcher).
- [x] **Live article sweep** validated the LLM call path end-to-end (real gpt-4o-mini + deepseek-chat calls succeeded); persistence validated by the constraint fix + CI (deploy-migrations applies it before integration tests).
- Phase 2 unit suite: 58 tests. All additive; escalation NOT wired into the live Elo ranking path (that is Phase 4, gated on the human go/no-go).

### Phase 3-5 (future, gated)
- Phase 3 (rubric-mode submatches + criteria-split) and Phase 4 (production ranking wiring) remain. **Phase 4 stays gated on the human go/no-go** (paragraph lone-decisive bar underpowered at n=20 — widen corpus first).

### (historical) Remaining (Phase 2) — was BLOCKED on a dev-schema apply (types dependency)
- [ ] Persistence DB glue: `upsertRun` escalation variant (chain/rule cols) + `replaceCalls`/persist submatch rows (the new `submatch_group_key`/`escalation_step`/`triggered_escalation`/`judge_model` columns). **Needs `database.types.ts` regenerated from the applied migration** — the typed insert can't be written until the columns exist in the generated types.
- [ ] `executeSweep` escalation mode (build `makeJudge` from `createCallLLMJudge` per model; per-pair `evaluatePairWithEscalation`; pass `chainCap` to the gate); leaderboard VIEW gains chain decisive/accuracy/cost/avg-depth.
- [ ] Admin UI (chain + rule selector + leaderboard) + CLI `sweep --chain ... --rule ...`.
- [ ] Apply migration to dev + small real-AI ARTICLE sweep (modest spend, authorized) to confirm offline numbers.

## Phase 3-5: rubric submatches, prod wiring, tuning
### Work Done
[Pending Phase 2 completion; Phase 4 gated on the acceptance numbers + corpus widening.]

## Phase 2: Offline ensemble simulation
### Work Done
[pending]

## Phase 3: Ensemble as Judge Lab sweep mode
### Work Done
[pending]

## Phase 4: Wire into production ranking (gated)
### Work Done
[pending]

## Phase 5: Other decisiveness/accuracy tactics
### Work Done
[pending]
