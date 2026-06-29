[//]: # (Research doc for the experiment-analysis skill project — captures problem statement, the user-supplied requirements verbatim, and the docs/code read during research.)

# Experiment Analysis Skill Research

## Problem Statement

Create a new skill for analyzing experiments. The skill is meant to be combined with (or composed alongside) the existing `/write_doc_for_completed_analysis` skill so that evolution-pipeline experiments (typically launched via `/manual_run_experiment`) can be analyzed in a rigorous, repeatable, adversarially-validated way — going beyond ad-hoc spreadsheets and one-off SQL into a structured workflow that always produces a balance check, statistical-significance assessment, decisiveness inspection, and a final per-component multi-agent review until 5/5.

## Requirements (from GH Issue #1303)

Figure out how to combine this with analysis skill

As the first step, always start with an experiment analysis plan to outline which steps in the process need to be compared between test vs. control

- High level: Run —> round —> agent invocation
- Agent invocation: parent —> operations —> child —> elo impact
- Operations: individual rounds, edits proposed, passes, etc

Always start with quick checks for experimental balance

- Compare each step in the generation process side by side to assess for balance
- Count number of things produced produced at each step
- Dig into the inputs and outputs of each step to make sure that things worked correctly, whether for existing code for new code

Assessing if new changes are working

- Be especially carefully that any recent code changes are working correctly
- Analyze in depth what changed in test - did the updated feature work as intended

How to interpret results

- Always make sure we have a way to check statistical significance vs. noise
- Never assume causality - always dig into data and specific examples to find evidence that the effect is real
- Never report anecdotes alone - only use anecdotes to provide examples for general patterns you have already investigated
- Always share simple examples with user to provide intuition on why changes are working or not
- Make sure to look at how often judges are being decisive

Validation of analysis

- Always spawn multiple agents to adversarially validate results
- Pattern after plan-review - create a similar framework that uses multiple agents to critique from multiple perspectives
- Do not stop until all components are 5/5
- Be as rigorous and as thorough as possible
- Critique the methodology and look for flaws

Final output

- Produce at least two tables
    - Test vs. control - summary of metrics
    - Experimental validity check - show numbers at each step of the funnel for test vs. control
- Propose follow-up ideas to make the analysis more effective

## High Level Summary

> **Naming update (2026-06-28):** `/analysis` was renamed to **`/write_doc_for_completed_analysis`** in this branch (commit 722895e12) — the previous name implied that skill *ran* analyses when it only writes them up. All references below use the new name. The new production skill is **`/run_experiment_analysis`** (this project's deliverable).

`/run_experiment_analysis` should be a **new, composable** skill that slots **between `/manual_run_experiment` (which produces the runs) and `/write_doc_for_completed_analysis` (which promotes findings to `docs/analysis/`)** — not an extension of either. It is a *production* skill (generates findings by querying the DB, running stats, validating them adversarially); `/write_doc_for_completed_analysis` is a *promotion* skill (crystallizes findings into a durable, reproducible report). Mixing the two would conflate "do the analysis" with "publish the analysis."

The new skill operates on the **active project** (resolved by current branch, identical to `/research` / `/write_doc_for_completed_analysis`); it does NOT require its own `/initialize` invocation. It reads + augments the existing project's `_research.md` and `_planning.md`, writes a self-contained `EAR.md` (Experiment Analysis Report) into the project folder, runs an adversarial 5/5 review loop, asks the user to evaluate the result, and on approval transparently invokes `/write_doc_for_completed_analysis` to promote the report into `docs/analysis/<name>/`.

Concrete lifecycle (composition, not replacement):

```
/initialize <project>                       → docs/planning/<project>/  (research/planning/progress + GH issue)
/research / plan / plan-review              → 5/5 readiness on the PLAN, incl. ## Pre-Registered Analysis Plan section
/manual_run_experiment                      → seed script + runs queued + waits for completion
                                              Step 7 now calls /run_experiment_analysis (not /write_doc_for_completed_analysis directly)
[NEW] /run_experiment_analysis                  → 1. Refuses to run if PRAP missing from _planning.md (writes a template if absent)
                                              2. Funnel/balance audit  (per-arm counts at every pipeline step)
                                              3. Significance computation (named stat test from PRAP, CIs)
                                              4. Judge-decisiveness audit (decisive % @0.6, tie %, position-bias %)
                                              5. Causal-evidence pass    (concrete examples per pattern, never anecdotes alone)
                                              6. Calls /analysis-review-loop until 5/5 across 3 perspectives
                                              7. Writes EAR.md to docs/planning/<project>/EAR.md (working draft + archive)
                                              8. Asks user to evaluate the EAR
                                              9. On approval → transparently invokes /write_doc_for_completed_analysis
[NEW] /analysis-review-loop                 → Reusable adversarial loop (mirrors /plan-review-loop)
                                              Callable from /run_experiment_analysis OR standalone for non-experiment analyses
                                              Perspectives caller-parameterized:
                                                from /run_experiment_analysis: Methodology / Statistical Validity / Causal Evidence
                                                standalone:                Methodology / Evidence Quality / Caveat Completeness
/write_doc_for_completed_analysis           → Promotes EAR findings into docs/analysis/<name>/<name>.md (durable)
                                              Runs its existing Step 3 findings-picker (user picks which EAR findings to promote)
                                              Adds dataset.csv + queries.sql per existing convention
                                              EAR.md stays in docs/planning/<project>/ as the working/archive copy
```

The DB-level **funnel taxonomy** (used for the balance audit) is grounded in real columns from `supabase/migrations/`: experiments group runs (`evolution_runs.experiment_id`), arms are identified by `evolution_runs.strategy_id` → `evolution_strategies.id`, iterations are denormalized onto invocations (`evolution_agent_invocations.iteration`), operations live inside `execution_detail` JSONB (agent-specific schemas), variants are children of an invocation (`evolution_variants.run_id` + `generation` + `parent_variant_ids[0]`), and Elo impact is `evolution_variants.elo_score` / `mu` / `sigma` updated via `evolution_arena_comparisons`. Decisiveness is governed by `DECISIVE_CONFIDENCE_THRESHOLD = 0.6` (see `evolution/src/lib/shared/rating.ts`).

The **gold-standard worked example** is `docs/analysis/wi_holistic_prompt_priming/` (4 arms × 30 pairs, pre-registered rule "flip rate > 15% OR L1 > 0.3 with non-overlapping CIs", McNemar + Spearman + L1-distance CIs, position-bias 30–67% per arm tabled, 5-caveat section). The strongest *failure* case to learn from is `docs/analysis/coherence-pass-perf-ab-results-20260624/` — pre-registered FAIL via Mann-Whitney p≈0.47, then the analyst correctly pivoted to root-cause (agent emitted clean rewrites in 8/15 invocations instead of CriticMarkup edits) but **should have stratified by "coherence-pass invoked" as a blocking factor in the Mann-Whitney itself**. That stratification gap is exactly what the new skill's Step 2 (funnel/balance audit) is designed to catch *before* the stat test runs.

## Key Findings

1. **`/write_doc_for_completed_analysis` is a promotion skill, not a production skill.** It assumes findings already exist in `_research.md` (Steps 2–3 explicitly require `## High Level Summary` + `## Key Findings` to be non-empty). It then makes them durable (subfolder, dataset.csv, queries.sql, bidirectional provenance into `_status.json.analyses[]` + `## Promoted Analyses` in research doc). It does NOT compute stats, audit balance, or validate adversarially. The 5 required `## ` headers are enforced by `scripts/check-skill-sections.sh` — if the new skill adds any new section to `/write_doc_for_completed_analysis`'s template, the check script must be updated in the same PR.

2. **`/manual_run_experiment` already invokes `/write_doc_for_completed_analysis`** (Step 7) but does not run any rigorous validation. Its Step 7 specifies what the analysis report MUST contain (Methodology with exact script path + flags, Key Findings with per-arm median tactic-delta + decision-rule outcome, Dataset, Queries & Results, outlier-rule application) — these are the *content* requirements; the new skill provides the *methodology* to actually produce that content. The cleanest integration: change `/manual_run_experiment` Step 7 from "trigger `/write_doc_for_completed_analysis`" to "trigger `/run_experiment_analysis`, which will in turn trigger `/write_doc_for_completed_analysis` on success." Backward-compatible: if the user invokes `/write_doc_for_completed_analysis` directly, nothing breaks.

3. **`/plan-review-loop` is the exact pattern to mirror.** Three parallel Task agents with `subagent_type=Plan`, each returns strict JSON `{perspective, critical_gaps, minor_issues, readiness_score: 1-5, reasoning}`. Loop stops when `lowest_score === 5 AND all_critical_gaps.length === 0`. Max-iterations escape hatch = 5. State is persisted under `.claude/review-state/<name>.json`. The new skill should use a parallel directory `.claude/review-state/run_experiment_analysis-<project>.json` and 3 different perspectives (see Finding 7).

4. **Funnel taxonomy is queryable today** (no schema changes needed). The arm key is `evolution_runs.strategy_id`. The balance audit is a single GROUP BY across `evolution_runs` ↔ `evolution_agent_invocations` ↔ `evolution_variants` ↔ `evolution_arena_comparisons`. The Explore agent produced canonical SQL for: per-arm variant counts by iteration, per-arm invocation outcomes (success/fail/skip) by agent, and per-arm top-variant Elo gain vs seed. These belong in the skill's canned-SQL appendix.

5. **Per-operation counts live in `execution_detail` JSONB and are agent-specific.** For `generate_from_previous_article`: `execution_detail.generation.strategies[].status ∈ {'success','format_rejected','error'}`. For `paragraph_recombine`: `execution_detail.slots[].rewrites[].{status, dropReason, temperature, costUsd}`. The skill needs an *agent-aware* dispatch table for "what counts as 'produced' / 'dropped' at the operations layer for this agent type." This is critical for the "did the new feature actually fire?" check — `coherence-pass-perf-ab` lost a whole experiment because the proposer mode-missed in 8/15 invocations and nobody counted that until *after* the stat test reported FAIL.

6. **Judge decisiveness has a code-defined threshold: `DECISIVE_CONFIDENCE_THRESHOLD = 0.6`** (`evolution/src/lib/shared/rating.ts`). A match is "decisive" iff `evolution_arena_comparisons.confidence >= 0.6 AND winner != 'draw'`. Prior analyses (`judge_agreement_summary_tables.md`, `effect_adding_explanation_judge_accuracy.md`) also report confidence buckets (1.0, 0.7, 0.5 forced-TIE, 0.3, 0.0) — the skill should report both the binary decisive %, the full bucket distribution per arm, and the 2-pass reversal rate (position-bias proxy).

7. **Adversarial-review perspectives should be experiment-aware** (not the security/architecture/testing trio of `/plan-review-loop`). Proposed three perspectives, all return the same JSON shape `{perspective, critical_gaps, minor_issues, readiness_score: 1-5, reasoning}`:
   - **Methodology** — was the named statistical test the right one for this experiment shape? Was the pre-registered decision rule applied exactly as stated (no post-hoc threshold drift)? Was the outlier rule defined up front and applied visibly?
   - **Statistical Validity** — is per-arm N adequate for the chosen test? Are confidence intervals reported? Was significance computed against the *right* baseline (control arm, not pooled)? Is multiplicity (multi-arm, multi-criterion) corrected?
   - **Causal Evidence** — does the data actually support the *causal* claim, or is it a correlation? Are there unaddressed confounders (judge prompt priming, parent-quality differences, per-arm cost-cap interference, OpenRouter 402 wipeout)? Are concrete examples cited per claimed pattern, never anecdotes alone?

8. **Pre-Registered Analysis Plan (PRAP) gate is non-negotiable.** Per user requirements ("always start with an experiment analysis plan"), the skill MUST refuse to run on data until `_planning.md` contains a `## Pre-Registered Analysis Plan` section with: (a) arms + sample size, (b) named statistical test, (c) PASS/FAIL/INCONCLUSIVE thresholds with exact numbers, (d) per-arm balance metrics to compute, (e) judge-decisiveness threshold (default 0.6 from code), (f) outlier rule. If missing, the skill writes a template PRAP into `_planning.md` and asks the user to fill it in before continuing. This eliminates the "decide the rule after seeing the data" failure mode.

9. **Two mandatory output tables match the user's requirements verbatim and have clear columns:**
   - **Table A — Test vs Control Metrics Summary** — rows per arm; columns: `arm_label`, `n_runs_completed`, `top_elo`, `median_elo`, `top_elo_delta_vs_control`, `total_cost_usd`, `cost_per_improver_usd`, `significance_verdict` (PASS / FAIL / INCONCLUSIVE per PRAP).
   - **Table B — Experimental Validity Funnel** — rows per arm; columns: `runs_queued`, `runs_completed`, `invocations_total`, `invocations_success`, `invocations_failed`, `invocations_skipped`, `variants_produced`, `variants_synced_to_arena`, `matches_played`, `matches_decisive` (confidence ≥ 0.6). Any cross-arm divergence > ~15% on any column is a *balance flag* that must be explained in a `## Balance Notes` section before the verdict is reported.

10. **The skill should run sub-skills, not absorb them.** Specifically: it should *call* `/plan-review-loop`-style sub-routine internally for the adversarial review (don't re-implement); on success it should *suggest* `/write_doc_for_completed_analysis` to the user (don't auto-invoke — `/write_doc_for_completed_analysis` Step 5 requires user confirmation on the PII / dataset-promotion step, and Step 3 requires user pick of which findings to promote).

## Decisions Locked In (2026-06-28)

The following design points are confirmed by the user and are no longer open:

1. **`/manual_run_experiment` Step 7 is retargeted to `/run_experiment_analysis`.** It no longer calls `/write_doc_for_completed_analysis` directly. Backward-compatible: invoking `/write_doc_for_completed_analysis` standalone still works for non-experiment analyses.

2. **User-approval gate before promotion.** After the adversarial loop reaches 5/5, the skill surfaces the EAR and asks the user to evaluate it. On approval, the skill *transparently* invokes `/write_doc_for_completed_analysis` (no second prompt) — `/write_doc_for_completed_analysis` then runs its own Step 3 findings-picker so the user can still choose which EAR findings to promote.

3. **Two-copy artifact model.**
   - `docs/planning/<project>/EAR.md` — the working draft + archive copy. Written by `/run_experiment_analysis` before the user-approval gate. Stays in place after promotion.
   - `docs/analysis/<name>/<name>.md` — the durable promoted artifact. Written by `/write_doc_for_completed_analysis` when invoked. Includes `dataset.csv` + `queries.sql` per `/write_doc_for_completed_analysis` convention. Bidirectional provenance is wired by `/write_doc_for_completed_analysis` (`_status.json.analyses[]` + `_research.md` `## Promoted Analyses`).

4. **`/analysis-review-loop` is extracted as a standalone reusable sub-skill** (mirrors `/plan-review-loop`). State at `.claude/review-state/analysis-review-<name>.json`. Three parallel `Task` agents (`subagent_type=Plan`), strict JSON output `{perspective, critical_gaps, minor_issues, readiness_score: 1-5, reasoning}`, stop when `lowest_score===5 && critical_gaps===0`, max 5 iterations. Perspectives are caller-parameterized:
   - From `/run_experiment_analysis`: **Methodology / Statistical Validity / Causal Evidence**.
   - From standalone usage (any author wrapping a non-experiment analysis): **Methodology / Evidence Quality / Caveat Completeness** (no significance/funnel concepts; reusable for observational, calibration, and investigation analyses).

5. **EAR is structured as a superset of `/write_doc_for_completed_analysis`'s 5 required headers.** `Header`, `Methodology`, `Key Findings`, `Dataset`, `Queries & Results` (mandatory per `scripts/check-skill-sections.sh`) PLUS `Pre-Registered Analysis Plan`, `Balance Audit`, `Decisiveness Audit`, `Causal Evidence`, `Adversarial Review Log`. Promotion is a copy, not a transformation.

6. **Six things inherited verbatim from `/write_doc_for_completed_analysis`:** (a) PII safety guard ("Confirm dataset.csv contains no PII before committing"), (b) size guard (≤1MB/10k inline; over → `sample.csv` + regen query + full row count), (c) the 5 enforced `##` headers, (d) kebab-case + dated subfolder naming, (e) bidirectional provenance writes, (f) `/write_doc_for_completed_analysis` Step 3 findings-picker is reused (not replicated).

7. **Non-experiment analyses keep going through `/write_doc_for_completed_analysis` directly** (no machinery they don't need). The new `/analysis-review-loop` sub-skill is the opt-in rigor for those: observational distribution studies, calibration / methodology studies, investigations / debugging. v1 of `/run_experiment_analysis` is experimental-only (requires `experiment_id`); no `--observational` mode.

8. **PRAP lives in `_planning.md`** as a new `## Pre-Registered Analysis Plan` section. Add it to the `/initialize` planning-doc template so every new experiment-shaped project has a slot from day 1. `/plan-review` reviews it for free.

9. **`/analysis` was renamed to `/write_doc_for_completed_analysis`** (commit 722895e12 on this branch). The old name implied that skill *ran* analyses; the new name makes it obvious that it only writes up a completed one. The 5-section template (`Header / Methodology / Key Findings / Dataset / Queries & Results`) is unchanged; only the docstring + filename + REQUIRED_SECTIONS key + 5 reference sites changed. Backward compatibility is N/A (slash-command name change is breaking by definition; the rename is part of this project's PR).

10. **Trigger phrase = `/run_experiment_analysis [experiment_id]`** (snake_case, long-descriptive style to mirror `/write_doc_for_completed_analysis`). Omitted `experiment_id` resolves via current branch's project planning doc, like `/research`.

11. **Canned SQL snippets live at `evolution/scripts/analysis/*.sql`** from day 1 (one file per query). `SKILL.md` references the file paths. Separation of concerns; each query is independently grep-able and runnable via `npm run query:staging -- "$(cat evolution/scripts/analysis/<file>.sql)"`. Filenames TBD in planning but expected set: `funnel_per_arm_variants.sql`, `funnel_per_arm_invocations.sql`, `funnel_per_arm_decisive_matches.sql`, `funnel_per_arm_top_elo_gain.sql`, `arena_only_wipeout_check.sql`, `judge_decisiveness_distribution.sql`, `per_arm_cost_breakdown.sql`.

12. **Per-section reviewer scoring** (literal reading of "all components 5/5"). Each of 3 reviewers (Methodology / Statistical Validity / Causal Evidence) scores each of ~6 substantive EAR sections separately: **PRAP-compliance, Balance Audit, Significance, Decisiveness Audit, Causal Evidence, Caveats**. 18 cells per iteration. Stop when `min(all_18_cells) === 5 && critical_gaps.length === 0`. The exact section list locks in during planning; current proposal omits mechanical sections (Header, Dataset, Queries & Results, Adversarial Review Log) from scoring. Each reviewer's JSON: `{perspective, section_scores: {prap_compliance, balance, significance, decisiveness, causal_evidence, caveats}, critical_gaps[], minor_issues[], overall_reasoning}`.

13. **Arena-only wipeout = hard gate, not soft warning.** Skill reuses the existing `evolution/scripts/detectArenaOnlyWipeouts.ts` fingerprint (variants=0 AND cost=0 AND success_generations>0 AND stopReason='arena_only'). If ANY run in ANY arm matches, the skill (a) refuses to compute significance, (b) surfaces affected runs prominently at the top of the Balance Audit section, (c) prompts user via `AskUserQuestion`: **drop run / rerun arm / proceed with explicit caveat**. The choice is recorded in EAR's Balance Audit section. Scoped to this one pattern for v1; future fingerprints (e.g. ranking-402, all-generations-failed-post-fix) extend via the same pattern.

14. **Multi-criterion experiments require PRAP-defined aggregation; fall back to per-criterion-only.** If PRAP names an aggregation rule (e.g. `"PASS iff ≥3 of 5 criteria show median shift ≥ +5 mu"` or `"PASS iff L1-distance > 0.3 across all criteria"`), the EAR reports both per-criterion AND aggregate verdicts. If PRAP doesn't name a rule, the EAR reports per-criterion only with NO aggregate verdict (explicitly NOT a multiplicity sin — each criterion is its own pre-registered test, matching the `wi_holistic_prompt_priming` pattern). The Statistical Validity reviewer's section_scores must flag any multi-criterion analysis lacking an aggregation rule when one was warranted by the experiment shape. No auto-Bonferroni — multiplicity correction is opt-in via PRAP, not imposed.

15. **`/initialize` extended with experiment-awareness (4-way branch).** After the existing branch-type question, `/initialize` asks: *"Will this project involve a controlled experiment?"* with 4 answers:
    - **A. No** — current behavior; current templates; `project_kind: "standard"`.
    - **B. Yes — Pattern 1 (feature + experiment)** — planning template gains `## Pre-Registered Analysis Plan` (after `## Options Considered`, before `## Phased Execution Plan`) and Phases 6-10 (seed script under `evolution/scripts/experiments/`, `/manual_run_experiment`, `/run_experiment_analysis`, `/write_doc_for_completed_analysis`, follow-up PR with script + analysis). `relevantDocs` auto-includes `evolution/docs/strategies_and_experiments.md`, `architecture.md`, `data_model.md`, `arena.md`, `rating_and_comparison.md`. `project_kind: "feature_with_experiment"`.
    - **C. Yes — Pattern 2 (pure validation)** — planning template is the smaller experiment-only shape (PRAP is primary content; no Implementation phases). Same evolution `relevantDocs` as B. `project_kind: "experiment_only"`.
    - **D. Maybe (decide later)** — current standard templates + an inline planning-doc note: *"If experimental validation becomes needed, run `/add_experiment_phases` to convert."* `project_kind: "standard"` (revisitable).
    Three planning templates to maintain (composition: B and C differ only by presence of Implementation phases; both add the PRAP section). The 4-way branch + `project_kind` is the systematic answer; the mechanical alternative ("just add PRAP to the uniform template and hope") was explicitly rejected.

16. **`project_kind` field added to `_status.json`.** Schema: `project_kind: "standard" | "feature_with_experiment" | "experiment_only"`. Read by:
    - `/run_experiment_analysis` — refuses to run on `standard` projects with a helpful error pointing at `/add_experiment_phases`. Reads `experiment_id` from a new `_status.json.experiment_id` field set after `/manual_run_experiment --apply`.
    - `/safe_to_close` — for `feature_with_experiment` or `experiment_only`, verifies that the analysis is promoted to `docs/analysis/` (i.e. `analyses[]` is non-empty) before allowing GREEN closure.
    - `/write_doc_for_completed_analysis` — surfaces EAR.md path automatically for experiment kinds (current behavior unchanged for `standard`).
    Default value for projects predating this field is `standard` (treated identically to today's behavior — fully backward compatible).

17. **A new helper skill `/add_experiment_phases`** converts a `standard` project to `feature_with_experiment` mid-cycle (Pattern 3). It appends the PRAP section, the experiment phases, and the evolution `relevantDocs`, and flips `project_kind` in `_status.json`. Small skill; ships in same PR as v1 of `/run_experiment_analysis` (per scope decision below).

18. **Scope expansion is in-scope for this PR.** Per `feedback_no_separate_projects_without_agreement` + `feedback_systematic_over_mechanical`, folding `/initialize` changes + the new helper into this project produces a coherent ship: new skill + the workflow that funnels into it. Reviewers see the full picture. Cost: larger PR; offset by clearer review story. The deliverables expand from "1 new skill + 1 sub-skill + 1 modify" to:
    - NEW: `.claude/commands/run_experiment_analysis.md` (or `.claude/skills/run_experiment_analysis/SKILL.md`)
    - NEW: `.claude/skills/analysis-review-loop/SKILL.md`
    - NEW: `.claude/commands/add_experiment_phases.md`
    - NEW: `evolution/scripts/analysis/*.sql` (7 files)
    - MODIFY: `.claude/commands/initialize.md` (4-way branch + 3 templates)
    - MODIFY: `.claude/skills/manual_run_experiment/SKILL.md` (Step 7 retargets)
    - MODIFY: project planning-doc templates (3 variants, possibly shared via composition)
    - MODIFY: `_status.json` schema docs (add `project_kind`, `experiment_id`)
    - MODIFY: `/safe_to_close` (optional in v1; can defer if PR grows too large) — read `project_kind` and verify promote-completion gate

## Open Questions

(none — all 5 plan-phase open questions resolved 2026-06-28; 4 follow-on decisions (15-18) from the workflow design also locked. Planning doc draft is fully unblocked.)

## Documents Read (this research round)

- `.claude/commands/write_doc_for_completed_analysis.md` (full; was `analysis.md` before rename)
- `.claude/skills/plan-review-loop/SKILL.md` (full)
- `.claude/skills/plan-review/SKILL.md` (frontmatter + first 80 lines)
- `.claude/skills/manual_run_experiment/SKILL.md` (full)
- `evolution/docs/rating_and_comparison.md` (Elo/uncertainty, decisive threshold)
- `docs/analysis/wi_holistic_prompt_priming/README.md` (gold standard; via Explore-agent survey)
- `docs/analysis/coherence-pass-perf-ab-results-20260624/...` (FAIL case; via Explore-agent survey)
- `docs/analysis/judge_agreement_summary_tables.md` + `judging_accuracy_20260412.md` + `effect_adding_explanation_judge_accuracy.md` (judge-decisiveness patterns; via Explore-agent survey)
- 5 federal-reserve-2 observational analyses under `docs/analysis/` (template patterns; via Explore-agent survey)

## Code Files Read (this research round)

- Funnel taxonomy verified by Explore agent against `supabase/migrations/*evolution*.sql` and `evolution/src/lib/pipeline/types.ts` + `evolution/src/services/`. Key tables: `evolution_experiments`, `evolution_runs`, `evolution_agent_invocations`, `evolution_variants`, `evolution_arena_comparisons`, `evolution_metrics`, `evolution_strategies`, `evolution_prompts`, `evolution_budget_events`, `llmCallTracking`. Key columns: `evolution_runs.strategy_id` (arm key), `evolution_variants.{elo_score, mu, sigma, arena_match_count, parent_variant_ids[], generation, synced_to_arena}`, `evolution_arena_comparisons.{winner, confidence, status}`, `evolution_agent_invocations.{iteration, success, skipped, error_message, execution_detail JSONB}`. Decisive threshold constant: `DECISIVE_CONFIDENCE_THRESHOLD = 0.6` in `evolution/src/lib/shared/rating.ts`.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (evolution + analysis surface area)
- evolution/docs/strategies_and_experiments.md — experiment lifecycle, strategy registry, aggregate reporting
- evolution/docs/architecture.md — run → round → invocation pipeline shape
- evolution/docs/data_model.md — entities and relationships to query for analysis
- evolution/docs/arena.md — Elo / OpenSkill comparison math, per-variant uncertainty
- evolution/docs/rating_and_comparison.md — judge call semantics, decisiveness
- evolution/docs/evolution_metrics.md — metric computation + storage
- evolution/docs/cost_optimization.md — cost & budget instrumentation
- evolution/docs/implicit_rubric_weights.md — recent worked example of an analysis (4-arm priming study) to pattern after
- evolution/docs/reference.md — operational reference for entities/services

### Existing skills to compose with / pattern after (read but not in relevantDocs)
- .claude/commands/write_doc_for_completed_analysis.md — promotion skill that this new skill must compose with (renamed from /analysis on this branch)
- .claude/skills/plan-review/SKILL.md — adversarial multi-agent loop pattern (target: 5/5 across reviewers)
- .claude/skills/plan-review-loop/SKILL.md — looping variant
- .claude/skills/manual_run_experiment/SKILL.md — the upstream skill that produces the experiments this one analyzes

## Code Files Read

(to be populated by /research)
