[//]: # (Planning doc for the experiment-analysis skill project — phased plan, testing strategy, verification, and review log.)

# Experiment Analysis Skill Plan

## Background

Create a new skill `/run_experiment_analysis` for analyzing evolution-pipeline experiments. It composes with the existing `/write_doc_for_completed_analysis` skill (the renamed promotion skill that formalizes findings into `docs/analysis/<name>/`) and the upstream `/manual_run_experiment` skill (which runs the experiments). The new skill enforces a rigorous workflow: a Pre-Registered Analysis Plan (PRAP) gate first, then balance checks across every pipeline step (with hard-gate arena-only wipeout detection), then a causal-evidence pass (not anecdotes), then a per-section adversarial 5/5 review loop via the new sub-skill `/analysis-review-loop`, then user approval, then transparent handoff to `/write_doc_for_completed_analysis` for promotion.

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

## Problem

Experiment results today are analyzed ad-hoc with one-off SQL and prose, producing analyses that are hard to reproduce, easy to bias toward anecdote, and unforgiving when the experiment itself was imbalanced (different N per arm, judge non-decisiveness, broken instrumentation in one arm only). Three failure modes have already cost real time:

1. **Post-hoc decision rules.** Without pre-registration, the analyst can drift the threshold to fit the data — destroying the test's epistemic value. The gold-standard `docs/analysis/wi_holistic_prompt_priming/` analysis avoided this by pre-registering "flip rate > 15% OR L1 > 0.3 with non-overlapping CIs"; most prior analyses didn't.
2. **Silent arena-only wipeouts.** Runs that "complete" with 0 variants + 0 cost + `stopReason='arena_only'` (OpenRouter 402 / D5 `max_tokens` trip) are statistical garbage that look like successes at the run-status level. The ranking-path 402 was sibling-unpatched after the D5 generation-path fix until the 2026-06-23 sweep.
3. **Stat-test-before-balance-check.** `docs/analysis/coherence-pass-perf-ab-results-20260624/` correctly applied Mann-Whitney → FAIL, then discovered post-hoc that the proposer mode-missed in 8/15 invocations (emitted clean rewrites instead of CriticMarkup edits). A pre-test balance audit stratified by "coherence-pass invoked" would have caught the mode mismatch *before* the stat test ran.

This project introduces `/run_experiment_analysis` to impose pre-registration, per-step balance audit, arena-only wipeout hard-gate, judge-decisiveness audit, causal-evidence pass, and a per-section adversarial 5/5 review loop — closing all three failure modes by construction.

## Directory Placement Convention

The 3 new skill specs follow the existing repo pattern (user-invoked commands in `.claude/commands/`, sub-skills that one command invokes internally in `.claude/skills/`):

| Skill | Path | Pattern mirror |
|---|---|---|
| `/run_experiment_analysis` | `.claude/commands/run_experiment_analysis.md` | matches `/plan-review`, `/finalize`, `/safe_to_close`, `/write_doc_for_completed_analysis` (user-invoked commands) |
| `/add_experiment_phases` | `.claude/commands/add_experiment_phases.md` | matches `/safe_to_close`, `/initialize` (user-invoked helpers) |
| `/analysis-review-loop` | `.claude/skills/analysis-review-loop/SKILL.md` | matches `/plan-review-loop`, `/manual_run_experiment` (sub-skills + workflow skills) |

The pairing of `/plan-review` (command) + `/plan-review-loop` (skill) is the existing precedent that `/run_experiment_analysis` (command) + `/analysis-review-loop` (skill) mirrors.

## Architecture (Locked)

Replaces the original Options A/B/C framing. All 18 design decisions are captured in `experiment_analysis_skill_20260628_research.md` `## Decisions Locked In (2026-06-28)`; this section summarizes the architecture they jointly produce.

```
/initialize <project>                    → 4-way branch on "controlled experiment?"
                                           Sets project_kind in _status.json
  ├─ A. No                               → standard template, project_kind: "standard"
  ├─ B. Pattern 1 (feature + experiment) → adds PRAP + Phases 6-10; project_kind:
  │                                         "feature_with_experiment"
  ├─ C. Pattern 2 (pure validation)      → smaller PRAP-primary template; project_kind:
  │                                         "experiment_only"
  └─ D. Maybe                            → standard template + inline note pointing at
                                            /add_experiment_phases

/manual_run_experiment                   → seed script + runs + writes experiment_id to
                                           _status.json after --apply
                                           Step 7 NOW triggers /run_experiment_analysis
                                           (was: /write_doc_for_completed_analysis)

/run_experiment_analysis [experiment_id] → Pre-flight gates → balance audit
                                           (with arena-only wipeout HARD GATE) →
                                           significance per PRAP-named test →
                                           decisiveness audit → causal-evidence pass →
                                           /analysis-review-loop until 18/18 cells = 5 →
                                           write EAR.md → user approval →
                                           transparent /write_doc_for_completed_analysis

/analysis-review-loop                    → 3 reviewers × 6 EAR sections = 18 cells
                                           Stop when min(cells) === 5 && critical_gaps === 0
                                           Reusable from /run_experiment_analysis OR
                                           standalone for observational/calibration analyses
                                           (different section list in standalone mode)

/add_experiment_phases                   → Converts standard project to feature_with_experiment
                                           Idempotent (skips sections already present)

/write_doc_for_completed_analysis        → Already renamed (Phase 0 done). Promotes EAR
                                           findings to docs/analysis/<name>/.
                                           Project-folder EAR.md stays as the archive copy.

/safe_to_close                           → For experiment kinds, verify analyses[] non-empty
                                           before GREEN (defer-able from v1).
```

## Phased Execution Plan

### Phase 0: Rename `/analysis` → `/write_doc_for_completed_analysis` (DONE) + naming-note backfill

Already committed to this branch as `722895e12`. Listed here for completeness; one backfill remains.

- [x] `git mv .claude/commands/analysis.md .claude/commands/write_doc_for_completed_analysis.md`
- [x] Update `scripts/check-skill-sections.sh` REQUIRED_SECTIONS key
- [x] Update 3 references in `.claude/skills/manual_run_experiment/SKILL.md` (frontmatter description, Step 7 header, Anti-Patterns + Related)
- [x] Update 1 reference in `docs/feature_deep_dives/judge_evaluation.md`
- [x] Add naming-note callout at top of the renamed file pointing at the new production skill
- [x] **Backfill:** the naming-note callout currently reads "see `/experiment-analysis`" (legacy proposal name) — must be updated to `/run_experiment_analysis` (locked Decision #10). Do as the very first edit of Phase 5 (or earlier — independent of any other phase).

### Phase 1: `_status.json` schema + `/initialize` 4-way branch + section-check lint entries

- [x] Document the schema additions in `docs/docs_overall/project_workflow.md` (the section that describes `_status.json`): add `project_kind` (default `"standard"`) and `experiment_id` (default `null`).
- [x] Add `REQUIRED_SECTIONS` entries to `scripts/check-skill-sections.sh` for the three new skill spec files in the SAME PR (don't defer to "after stable" — this protects against the exact regression class — silent deletion of e.g. the wipeout HARD GATE step — that motivated the lint):
  - `.claude/commands/run_experiment_analysis.md` → required: `## Workflow`, `## Pre-flight Gates`, `## EAR Output Template` (the H2s inside the spec; the template block within `## EAR Output Template` must list the 10 EAR `## ` headers)
  - `.claude/skills/analysis-review-loop/SKILL.md` → required: `## When to Use`, `## Workflow`, `## Reviewer JSON Schema`, `## Stop Condition`
  - `.claude/commands/add_experiment_phases.md` → required: `## Usage`, `## Pre-conditions`, `## Actions`
- [x] Modify `.claude/commands/initialize.md` Step 1.5: add a 4th `AskUserQuestion` after branch-type — *"Will this project involve a controlled experiment?"* with 4 options:
  - **A. No** (Recommended for most projects)
  - **B. Yes — Pattern 1: feature + experiment** (build a feature whose value needs validation)
  - **C. Yes — Pattern 2: pure validation** (no new feature, just comparing existing configs)
  - **D. Maybe, decide later**
- [x] Modify Step 3.5: write `project_kind` (`standard`/`feature_with_experiment`/`experiment_only`/`standard` for D) and `experiment_id: null` to `_status.json`.
- [x] Modify Step 5: select planning-doc template based on `project_kind`. Composition rule:
  - `standard` → current template (unchanged baseline)
  - `feature_with_experiment` → baseline + `## Pre-Registered Analysis Plan` section (between `## Options Considered` and `## Phased Execution Plan`) + Phases 6-10 stub (seed script / `/manual_run_experiment` / `/run_experiment_analysis` / `/write_doc_for_completed_analysis` / follow-up PR)
  - `experiment_only` → smaller variant: drop the Implementation phase; PRAP becomes primary content; Phases simplify to PRAP / seed script / run / analyze / promote / PR
  - `D. Maybe` (project_kind `standard`) → baseline + inline note at end of `## Background`: *"If experimental validation becomes needed later, run `/add_experiment_phases` to convert."*
- [x] Modify Step 2.7: for Pattern 1/2, auto-include `evolution/docs/strategies_and_experiments.md`, `architecture.md`, `data_model.md`, `arena.md`, `rating_and_comparison.md` in `relevantDocs` (no user confirmation needed — these are guaranteed-relevant for experiment projects).
- [x] Make the new question skippable via existing env-var bypass (`WORKFLOW_BYPASS=true`) — defaults to `standard` when bypassed.

### Phase 1.5: Testable TS extractions at `scripts/skills/` (NEW — supports Phase 1/2/5/6 testing)

Skill specs are markdown; the load-bearing logic they invoke needs JS/TS extractions so it can be unit-tested. Add a new `scripts/skills/` directory with pure-function TS modules. The skill specs reference these modules; tests exercise them directly.

**Directory rationale:** `scripts/` already hosts skill-adjacent utilities (`check-skill-sections.sh`, `summarize-test-results.ts`, `query-db.ts`). The new `scripts/skills/` subdir semantically groups testable extractions of skill orchestration logic. tsconfig.ci.json already includes `scripts/**/*.ts`, so type-checking + Jest both pick these up without config changes.

- [x] Create `scripts/skills/wipeout-gate.ts` — pure function `parseWipeoutDetectorOutput(json: string): WipeoutRow[]` that takes the detector's `--json` envelope and returns the `.wipeouts` array (or `[]` for empty/malformed input). Also exports `shouldFireHardGate(wipeouts: WipeoutRow[]): boolean`. Skill Phase 5 Step 3 invokes via `npx tsx scripts/skills/wipeout-gate.ts --parse "$WIPEOUT_JSON"` for parsing — same module both shell-callable and import-able.
- [x] Create `scripts/skills/wipeout-gate.test.ts` — Jest unit tests covering: (a) empty wipeouts envelope → `[]`; (b) populated envelope → array of rows; (c) malformed JSON → `[]` + warning; (d) detector-exit-1 output mixed with `|| true` capture; (e) `shouldFireHardGate([])` returns false, `shouldFireHardGate([row])` returns true. **Targets the load-bearing safety property — a regression here silently disables the wipeout HARD GATE.**

- [x] Create `scripts/skills/manual-run-experiment-capture.ts` — pure functions:
  - `extractExperimentId(seedScriptStdout: string): string | null` — regex-parses the 3 known shapes (new / Reusing existing / Reusing); returns null if none match (skill turns this into the explicit error per Phase 6 spec).
  - `validateStatusJsonExperimentId(current: string | null | undefined, captured: string): 'write' | 'noop' | 'error'` — pure implementation of the idempotency contract (absent/null → write; equal → no-op; differs → error).
  - `resolveProjectFolderFromBranch(branchName: string): string | null` — strips the prefix (`feat/`, `fix/`, `chore/`, `docs/`, `hotfix/`) and returns the expected `docs/planning/<...>` path; returns null if no project folder maps cleanly.
- [x] Create `scripts/skills/manual-run-experiment-capture.test.ts` — fixtures of representative seed-script outputs (`seedBundleSplitExperiment_*.ts`, `seedCoherencePassPerfAbExperiment_*.ts`, `seedEloAgentComparisonExperiment_20260626.ts` — the one with the alt "Reusing experiment" phrasing). Assertions: (a) all 3 fixture shapes extract a UUID; (b) malformed input → null; (c) idempotency three-way (absent → write; equal → noop; differs → error); (d) branch prefix stripping for all 5 known prefixes + the no-match fallback.

- [x] Create `scripts/skills/initialize-template-selector.ts` — pure function `selectPlanningTemplate(projectKind: ProjectKind): { template: string, prap: boolean, experimentPhases: boolean }` returning the right template variant per Phase 1's branching rules. Importable from both the SKILL.md instructions and the integration test.
- [x] Create `scripts/skills/initialize-template-selector.test.ts` — unit tests for all 4 branch answers (No / Pattern 1 / Pattern 2 / Maybe) + the `WORKFLOW_BYPASS=true` case (defaults to `standard`).

- [x] Create `scripts/skills/add-experiment-phases-helper.ts` — pure functions for the 4 idempotent edits the helper performs (append PRAP section if absent; append Phases 6-10 stub if absent; union evolution docs into `relevantDocs`; flip `project_kind`).
- [x] Create `scripts/skills/add-experiment-phases-helper.test.ts` — fixture project skeletons (standard / already-converted / partially-converted) + assertions on idempotency + refusal-on-already-converted.

- [x] Create `scripts/skills/prap-validator.ts` — pure function `validatePrap(planningDocText: string): { valid: boolean, missingMarkers: string[] }` that enforces the minimum-content rule per Phase 5 Step 1 (header present + body contains `arms` + `threshold` + one of `test:`/`Mann-Whitney`/`McNemar`/`Bootstrap`/`Spearman`/`permutation`, case-insensitive).
- [x] Create `scripts/skills/prap-validator.test.ts` — fixtures: empty PRAP section (invalid); header-only (invalid); arms+threshold but no test (invalid, names missing marker); full valid PRAP (valid); case-variants like `MANN-WHITNEY` (valid). **Targets bypass-prevention of the PRAP gate.**

### Phase 2: `/add_experiment_phases` helper

- [x] Create `.claude/commands/add_experiment_phases.md` (~80 lines).
- [x] Inputs: `[project-name]` optional; resolves from current branch like `/research`.
- [x] Pre-conditions: project's `_status.json` exists; `project_kind == "standard"` (refuse otherwise with a helpful error pointing at the current value).
- [x] Actions (all idempotent — re-running is safe):
  - Append `## Pre-Registered Analysis Plan` section to `_planning.md` (between `## Options Considered` and `## Phased Execution Plan`) if not present
  - Append experiment Phases 6-10 stub to `## Phased Execution Plan` if not present (anchor on Phase number — skip if Phase 6 already exists)
  - Add the 5 evolution docs to `_status.json.relevantDocs` if not already listed (set-union)
  - Flip `_status.json.project_kind` from `"standard"` to `"feature_with_experiment"`
- [x] Print summary of writes made + suggest next step (`/research` or `/plan-review`).

### Phase 3: Standard SQL snippets at `evolution/scripts/analysis/` + wipeout detector extension

**Parameterization mechanism (locked):** `query-db.ts` (the script behind `npm run query:staging`) currently has no `-v` flag. v1 approach is **sed substitution after UUID validation** to avoid extending the query runner:
```bash
# Pre-flight gate validates $EID parses as UUID (UUID v4 regex), THEN:
EID=<uuid>
QUERY=$(sed "s/\$experiment_id/'$EID'/g" evolution/scripts/analysis/<file>.sql)
npm run query:staging -- --json "$QUERY"
```
SQL files use the literal bare token `$experiment_id` — NOT pre-quoted in the SQL. Example: `WHERE r.experiment_id = $experiment_id::uuid`. The sed substitution inserts the surrounding single quotes itself, producing `WHERE r.experiment_id = '<uuid>'::uuid`. UUID validation happens at the Step 1 pre-flight gate BEFORE any sed or DB call. The UUID v4 character class `[0-9a-f-]` excludes all SQL and shell metacharacters, so the substitution is provably safe after validation passes.

**Filter convention:** All 7 SQL files filter `r.status IN ('completed', 'failed')` (NOT just `completed`) so failed runs with `error_code='all_generations_failed'` (post-D3 wipeouts) are visible in funnel counts. The skill handles them in downstream aggregation.

All queries use `evolution_runs.strategy_id` for arm grouping. All runnable via the parameterization recipe above.

- [x] `funnel_per_arm_variants.sql` — per-arm variant counts by iteration, plus synced-to-arena split. **Use `COUNT(v.id)` not `COUNT(*)` to avoid the LEFT JOIN null-row inflation bug** (empty-arm runs would otherwise yield `COUNT(*) = 1` from the unmatched-row synthesis):
  ```sql
  SELECT r.strategy_id, s.name AS arm,
         COALESCE(v.generation, -1) AS iteration,  -- -1 sentinel for runs with zero variants
         COUNT(v.id) AS variants_produced,         -- COUNT(v.id), not COUNT(*)
         COUNT(v.id) FILTER (WHERE v.synced_to_arena) AS variants_synced
  FROM evolution_runs r
  JOIN evolution_strategies s ON s.id = r.strategy_id
  LEFT JOIN evolution_variants v ON v.run_id = r.id
  WHERE r.experiment_id = $experiment_id::uuid
    AND r.status IN ('completed', 'failed')
  GROUP BY r.strategy_id, s.name, COALESCE(v.generation, -1)
  ORDER BY s.name, iteration;
  ```
- [x] `funnel_per_arm_invocations.sql` — per-arm invocation outcomes by `agent_name` + `iteration` (success / failed / skipped counts via `FILTER (WHERE ...)`).
- [x] `funnel_per_arm_decisive_matches.sql` — per-arm decisive-match count (`confidence >= 0.6 AND winner IN ('a','b')`) + tie / draw rate. Threshold sourced from `DECISIVE_CONFIDENCE_THRESHOLD = 0.6` in `evolution/src/lib/shared/rating.ts`.
- [x] `funnel_per_arm_top_elo_gain.sql` — per-arm: top final `elo_score` minus seed `elo_score` (synced variants only). Definition: "top" = `max(elo_score) WHERE synced_to_arena = true`; "seed" = `max(elo_score) WHERE generation = 0 AND synced_to_arena = true`.
- [x] `judge_decisiveness_distribution.sql` — confidence bucket distribution per arm (1.0 / 0.7 / 0.5-TIE / 0.3 / 0.0).
- [x] `per_arm_cost_breakdown.sql` — total cost + per-agent cost + cost-per-improver per arm. **Define "improver" inline in the SQL comment:** `improver = synced variant with elo_score > parent.elo_score` (i.e. produced a positive Elo delta vs its direct parent via `parent_variant_ids[0]` self-join).
- [x] `evolution/scripts/analysis/README.md` — index + usage examples (including the sed substitution recipe) + which skill consumes each query.

**Wipeout detection — REUSE the TS detector, do NOT write SQL fingerprint** (per Decision #13). The previously-proposed `arena_only_wipeout_check.sql` would diverge from `evolution/scripts/detectArenaOnlyWipeouts.ts`'s canonical fingerprint (which matches BOTH `status='completed' AND stopReason IN ('arena_only', NULL) AND generate_invocation_count > 0 AND variant_count = 0` AND post-D3's `status='failed' AND error_code='all_generations_failed'`). Instead, extend the TS detector. **Correction from iteration 1's wording:** the detector ALREADY supports `--json` (emits envelope `{target, sinceHours, count, wipeouts}`); only `--experiment-id` is new:

- [x] **Extend `evolution/scripts/detectArenaOnlyWipeouts.ts`** with one new flag and document existing-flag behavior:
  - `--experiment-id <uuid>` (NEW) — scope detection to a single experiment. When set, **supersedes** the `--hours` time window entirely (an experiment-scoped query should not be time-filtered).
  - `--json` (existing — DO NOT change shape; back-compat for `.github/workflows/evolution-run-health.yml` and any other callers) — keeps emitting `{target, sinceHours, count, wipeouts}`. Skill parses `.wipeouts` from the envelope (a JSON array of wipeout rows).
  - Existing behavior: detector exits with code 1 when wipeouts are found (intentional for cron alerting). Skill MUST tolerate this exit code — see Step 3 invocation below.
- [x] Skill Phase 5 Step 3 calls the TS detector directly with exit-code tolerance:
  ```bash
  # `|| true` consumes the exit-1 from "wipeouts found"; we infer wipeouts from .wipeouts being non-empty,
  # not from the exit code. Without `|| true`, the skill aborts before reading JSON when wipeouts exist.
  WIPEOUT_JSON=$(npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id "$EID" --json || true)
  WIPEOUTS=$(echo "$WIPEOUT_JSON" | jq -c '.wipeouts // []')
  # If $WIPEOUTS is [] → continue; if non-empty → fire hard-gate AskUserQuestion.
  ```
  Single source of truth for the fingerprint; no risk of SQL/TS drift; back-compatible with existing callers.

### Phase 4: `/analysis-review-loop` sub-skill

- [x] Create `.claude/skills/analysis-review-loop/SKILL.md` (mirror of `.claude/skills/plan-review-loop/SKILL.md`, ~180 lines).
- [x] **No YAML frontmatter** — mirror `.claude/skills/plan-review-loop/SKILL.md` exactly (it has no frontmatter; the first line is `# Multi-Agent Plan Review Loop`). Trigger is the slash-command name + the agent's awareness; the H2 sections (`## When to Use`, `## Workflow`, etc.) carry the structure. Consistent with the existing sibling skill.
- [x] State file: `.claude/review-state/analysis-review-<name>.json` (gitignored via existing `.claude/review-state/` rule if present; add if absent).
- [x] Inputs: `--target=<path-to-EAR.md>` (required), `--perspective-set={from-experiment-analysis | from-standalone}` (required), `--max-iterations=<N>` (optional; default 5).
- [x] Three parallel `Task` agents with `subagent_type=Plan` per iteration. Perspectives by `--perspective-set`:
  - `from-experiment-analysis`: **Methodology**, **Statistical Validity**, **Causal Evidence**
  - `from-standalone`: **Methodology**, **Evidence Quality**, **Caveat Completeness**
- [x] Reviewer JSON schema (strict — used as the StructuredOutput contract for each agent):
  ```jsonc
  {
    "perspective": "string",                  // matches the dispatched perspective
    "section_scores": {                       // per-section 1-5
      "prap_compliance": 1,                   // 'NA' allowed in standalone mode
      "balance": 1,                           // 'NA' allowed in standalone mode
      "significance": 1,                      // 'NA' allowed in standalone mode
      "decisiveness": 1,                      // 'NA' allowed in standalone mode
      "causal_evidence": 1,
      "caveats": 1
    },
    "critical_gaps": ["string"],              // blockers; loop iterates until empty
    "minor_issues": ["string"],               // non-blockers; logged
    "overall_reasoning": "string"             // 2-3 sentences
  }
  ```
- [x] Stop condition: across all 3 reviewers AND all scored sections, `min(score) === 5 AND sum(critical_gaps) === 0`. `NA` scores are excluded from the min computation (standalone mode).
- [x] Iteration logic: when critical_gaps exist, present them to user via `AskUserQuestion` (apply-fixes / abort-loop / continue-with-known-gap). Apply-fixes edits `EAR.md`; re-run iteration.
- [x] Max-iterations escape hatch: same as `/plan-review-loop` (5 iterations; escalate to user for manual decision if not converged).
- [x] Persist full audit trail in state file: every iteration's 3 reviewer JSONs + the fixes applied.

### Phase 5: `/run_experiment_analysis` skill

- [x] Create `.claude/commands/run_experiment_analysis.md` (~250 lines).
- [x] Frontmatter: `name: run_experiment_analysis`, `description`, `allowed-tools: [Read, Write, Edit, Bash, Task, AskUserQuestion, TodoWrite]`.
- [x] Argument: `[experiment_id]` (optional; resolves from `_status.json.experiment_id` in current project).
- [x] **Step 1 — Pre-flight gates (fail-closed, ordered):**
  - [ ] Refuse if `_status.json` missing or unreadable (error: "Run `/initialize` first")
  - [ ] Refuse if `_status.json.project_kind == "standard"` (error: "Project not configured for experiments. Run `/add_experiment_phases` to convert.")
  - [ ] Refuse if `_planning.md` missing `## Pre-Registered Analysis Plan` section header (error: "PRAP required; the analysis plan must precede the data. Add `## Pre-Registered Analysis Plan` to `_planning.md` with: arms, sample size, named statistical test, PASS/FAIL/INCONCLUSIVE thresholds with exact numbers, per-arm balance metrics, judge-decisiveness threshold (default 0.6), outlier rule, and aggregation rule for multi-criterion experiments.")
  - [ ] **Refuse if PRAP section is empty or lacks minimum-content markers.** Grep alone is trivially bypassed (add empty header, gate passes). Require ALL of these tokens in the PRAP section body before allowing the skill to proceed (case-insensitive): `arms`, `threshold`, AND one of `test:` / `Mann-Whitney` / `McNemar` / `Bootstrap` / `Spearman` / `permutation`. Error names which marker is missing. Implementation lives in `scripts/skills/prap-validator.ts` with colocated tests (add to the Phase 1.5 module list).
  - [ ] Refuse if `experiment_id` cannot be resolved (error: "Pass `[experiment_id]` or run `/manual_run_experiment --apply` first to populate `_status.json.experiment_id`.")
  - [ ] **Validate `experiment_id` as a UUID v4** (regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) BEFORE any DB query. This bounds the sed-substitution injection surface.
  - [ ] Refuse if `experiment_id` not found in `evolution_experiments` table. **DB error handling (v1 — no retry):** if the existence query fails with a connection/timeout error, abort with a specific message naming the failing query + `npm run query:staging` invocation; user re-runs the skill. Same applies to every subsequent query in Step 2.
  - [ ] **Warn (not refuse) if `evolution_experiments.status NOT IN ('completed', 'cancelled')`** — analyzing a `draft` or `running` experiment is suspicious; user must confirm before proceeding.
- [x] **Step 2 — Funnel/balance audit:** run the 6 SQL files (per Phase 3; wipeout detection moved to TS detector — see Step 3) via the sed substitution recipe:
  ```bash
  EID=<validated-uuid>
  for f in evolution/scripts/analysis/{funnel_per_arm_variants,funnel_per_arm_invocations,funnel_per_arm_decisive_matches,funnel_per_arm_top_elo_gain,judge_decisiveness_distribution,per_arm_cost_breakdown}.sql; do
    QUERY=$(sed "s/\$experiment_id/'$EID'/g" "$f")
    npm run query:staging -- --json "$QUERY"   # parse JSON, aggregate
  done
  ```
  Aggregate results into `Balance Audit` table (per arm, per step).
- [x] **Step 3 — Arena-only wipeout HARD GATE via TS detector:** call the canonical detector directly (single source of truth; matches BOTH legacy `completed/arena_only` AND post-D3 `failed/all_generations_failed` shapes per Decision #13):
  ```bash
  WIPEOUTS=$(npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id "$EID" --json)
  ```
  Parse JSON; if non-empty array:
  - [ ] Print affected runs + arm
  - [ ] `AskUserQuestion`: 4 options — **drop this run** / **rerun this arm** (links to `/manual_run_experiment --append`) / **proceed with explicit caveat** / **abort**
  - [ ] Record the user's choice in EAR's `## Balance Audit` under "Wipeout Resolution"
  - [ ] Continue only after the user resolves; abort exits without writing EAR
- [x] **Step 4 — Significance computation per PRAP-named test:**
  - [ ] Parse the named test from PRAP (Mann-Whitney / McNemar / Bootstrap CI / Spearman / etc.)
  - [ ] For each PRAP-defined claim, compute the test and report the result (test statistic, p-value or CI bounds, conclusion against the PRAP threshold)
  - [ ] **Multi-criterion handling:** if PRAP names an aggregation rule, apply it AND report per-criterion. If no aggregation rule, report per-criterion only (no aggregate verdict). Statistical Validity reviewer is told to flag missing rules when the experiment shape warranted one.
- [x] **Step 5 — Judge-decisiveness audit:** run `judge_decisiveness_distribution.sql`. Surface per arm:
  - Decisive % (confidence ≥ 0.6, winner != 'draw')
  - Full bucket distribution (1.0 / 0.7 / 0.5-TIE / 0.3 / 0.0)
  - Position-bias % from 2-pass reversal data (if `evolution_arena_comparisons.aggregation_rule` includes 2-pass)
- [x] **Step 6 — Causal-evidence pass:** for each claimed pattern in the analysis:
  - [ ] Surface at least 2 concrete variant/invocation IDs as evidence
  - [ ] Refuse to ship pattern claims with zero example references — block until either evidence is added or the claim is downgraded to "anecdotal / single example" in the EAR
- [x] **Step 7 — Write EAR.md AND mirror summary to `_research.md`** (this amends Decision #16 — instead of modifying `/write_doc_for_completed_analysis` to detect EAR, `/run_experiment_analysis` writes findings to BOTH places so the promotion skill works unchanged):
  - Write `docs/planning/<project>/EAR.md` with all 10 sections:
    - Inherited (mirror the 5 headers `/write_doc_for_completed_analysis`'s template uses; section-check enforces them on the SKILL.md spec, not on per-analysis reports): `## Header`, `## Methodology`, `## Key Findings`, `## Dataset`, `## Queries & Results`
    - Experiment-specific: `## Pre-Registered Analysis Plan`, `## Balance Audit`, `## Decisiveness Audit`, `## Causal Evidence`, `## Adversarial Review Log`
    - Include the two mandatory tables: **Table A** (Test-vs-Control Metrics Summary) in `## Key Findings`; **Table B** (Experimental Validity Funnel) in `## Balance Audit`
    - Include follow-up suggestions in `## Key Findings` under a `### Follow-up Ideas` subheading
  - Append to `_research.md`:
    - `## High Level Summary` — paste/replace with EAR's 3-5 sentence summary (so `/write_doc_for_completed_analysis` Step 2's emptiness check passes)
    - `## Key Findings` — mirror EAR's `## Key Findings` numbered list verbatim (so Step 3's picker has structured findings to present)
    - `## Promoted Analyses` — leave for `/write_doc_for_completed_analysis` Step 6 to append on its bidirectional-provenance write
  - Both writes are idempotent (re-running the skill replaces these sections, doesn't duplicate)
- [x] **Step 8 — Adversarial review:** invoke `/analysis-review-loop --target=docs/planning/<project>/EAR.md --perspective-set=from-experiment-analysis`. Block until convergence (18/18 cells = 5) or max-iterations escape hatch.
- [x] **Step 9 — User approval:** `AskUserQuestion`: "EAR is ready at `<path>` (reviewed 18/18). Approve to promote to `docs/analysis/`?" — 3 options: **approve and promote** / **fix-then-promote (re-enter editor)** / **abort (keep EAR.md in project folder, do not promote)**.
- [x] **Step 10 — Transparent promotion** on approval: invoke `/write_doc_for_completed_analysis <project>`. That skill runs its existing Step 3 findings-picker against `_research.md`'s `## Key Findings` (which now mirrors EAR's findings per Step 7) and writes to `docs/analysis/<name>/<name>.md`. The EAR.md in the project folder stays in place as the archive. Print both paths.

### Phase 6: `/manual_run_experiment` Step 7 retarget + experiment_id capture

**experiment_id capture mechanism (locked):** The skill currently runs the seed script in the user's interactive shell and the user copy-pastes the printed ids. v1 capture mechanism is **run-via-tee + regex-parse** with pipefail to surface seed-script failures:

```bash
# /manual_run_experiment Step 5 runs the seed script via tee so stdout is captured.
# pipefail is REQUIRED — without it, a failed seed-script silently produces an empty
# $SEED_OUT and the standalone-skip warning misleads the user ("no project folder")
# instead of surfacing the real failure ("seed script failed").
set -o pipefail
SEED_OUT=$(mktemp)
npx tsx evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts \
  --target staging --runs-per-arm 8 --apply | tee "$SEED_OUT"
# If the seed-script exits non-zero, pipefail propagates and the skill aborts here.

# UUID regex matches the canonical 8-4-4-4-12 hex structure (NOT loose `[0-9a-f-]{36}`
# which would match e.g. 36 dashes). Matches Step 1's pre-flight UUID v4 gate.
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

# Three known seed-script output shapes (verified against current scripts in evolution/scripts/experiments/):
#   1. New experiment:            "experiment_id      = <uuid>"
#   2. Append (one phrasing):     "Reusing existing experiment <uuid>"
#   3. Append (alt phrasing):     "Reusing experiment <uuid>"   (e.g. seedEloAgentComparisonExperiment_20260626.ts:258)
EID=$(grep -Eo "experiment_id[[:space:]]*=[[:space:]]*$UUID_RE" "$SEED_OUT" \
      | head -1 | grep -Eo "$UUID_RE")
APPEND_EID=$(grep -Eo "Reusing(\\s+existing)?\\s+experiment\\s+$UUID_RE" "$SEED_OUT" \
            | head -1 | grep -Eo "$UUID_RE")
EID=${EID:-$APPEND_EID}

# If neither pattern matched (unrecognized seed-script output shape), error explicitly —
# do NOT fall through to the standalone-skip path (that masks regex bugs as "no project").
if [ -z "$EID" ]; then
  echo "ERROR: could not extract experiment_id from seed script output ($SEED_OUT)." >&2
  echo "       Expected one of: 'experiment_id = <uuid>' OR 'Reusing experiment <uuid>'." >&2
  echo "       This means a seed script was added that uses a different output convention." >&2
  echo "       Either fix the seed script to use one of the expected shapes, or extend" >&2
  echo "       the regex in scripts/skills/manual-run-experiment-capture.ts." >&2
  exit 2
fi
```

**Output-format contract for seed scripts:** as part of Phase 6, audit `evolution/scripts/experiments/*.ts` to confirm every script prints EITHER `experiment_id\s*=\s*<uuid>` (new) OR `Reusing(\s+existing)?\s+experiment\s+<uuid>` (append). Add this contract to `evolution/scripts/experiments/README.md` so future seed scripts conform. If any current script uses a different shape, fix it.

**Project context resolution:** `_status.json` write target = `docs/planning/<branch_name_minus_prefix>/_status.json`, where `<branch_name>` is `$(git branch --show-current)` and prefix is one of `feat/`, `fix/`, `chore/`, `docs/`, `hotfix/` (strip whichever matches; fall back to full name).

**Standalone-invocation edge case:** if no project folder resolves (skill invoked from `main` or a branch with no matching `docs/planning/` folder), **skip the `_status.json` write with a printed warning** ("Captured `experiment_id=<uuid>` but no project folder at `docs/planning/<...>` — write skipped. Pass `[experiment_id]` explicitly when invoking `/run_experiment_analysis`."). Skill continues; user can resume manually.

**Atomicity:** read-modify-write of `_status.json` is single-process (skill runs interactively, no concurrent skill invocations on the same project assumed). No file locking needed for v1.

- [x] Edit `.claude/skills/manual_run_experiment/SKILL.md` **Step 5** — append the capture block above. Frame as "after the seed script prints the experiment_id, the skill captures it and writes to `_status.json.experiment_id` of the active project."
- [x] **Step 5 idempotent contract for `_status.json.experiment_id` write:**
  - If field absent or `null` → write
  - If field present and equals captured value → no-op (re-run safe)
  - If field present and differs → ERROR with clear message ("Project already has `experiment_id=X` recorded. Either you're running a different experiment for this project (use a new project via `/initialize`) or the previous experiment was wrong (manually clear `_status.json.experiment_id` and re-run).")
- [x] Edit **Step 7** — retarget: change *"Trigger `/write_doc_for_completed_analysis`"* to *"Trigger `/run_experiment_analysis` (which transparently invokes `/write_doc_for_completed_analysis` on user approval)."* Update the content-requirements list to reference the EAR's 10 sections instead of the 5-section promoted-analysis template.
- [x] Update `## Related` section to reference `/run_experiment_analysis` and `/analysis-review-loop` alongside the existing `/write_doc_for_completed_analysis` pointer.
- [x] Frontmatter description: update the one-line summary to reference `/run_experiment_analysis` instead of `/write_doc_for_completed_analysis`.

### Phase 7 (OPTIONAL — defer-able): `/safe_to_close` `project_kind` awareness

- [x] Edit `.claude/commands/safe_to_close.md`: for `project_kind in {feature_with_experiment, experiment_only}`, verify `_status.json.analyses[]` is non-empty before allowing GREEN.
- [x] New YELLOW reason (NOT RED — the analysis may genuinely not be ready when the user wants to close): "Experiment project closure without promoted analysis."
- [x] No change for `standard` projects.
- [x] **Scope flag:** Can ship in a follow-up PR if v1 size is a concern. The skill works without this check; you just lose the `/safe_to_close` reminder that experiment projects need a promoted analysis.

## Testing

### Unit Tests
- [x] **Phase 1.5 TS extractions get colocated `*.test.ts` files** — see Phase 1.5 for the 5 modules + their tests (`wipeout-gate.test.ts`, `manual-run-experiment-capture.test.ts`, `initialize-template-selector.test.ts`, `add-experiment-phases-helper.test.ts`, `prap-validator.test.ts`). These cover the load-bearing safety properties (HARD GATE orchestration, regex parser, idempotency contract, PRAP minimum-content validation) that markdown specs can't enforce on their own. Run via `npm test` (Jest picks up `scripts/**/*.test.ts` automatically).
- [x] Skill specs themselves are markdown — no per-skill unit tests beyond the extractions above.
- [x] **Section-check enforcement IS in v1** (per Phase 1) — not deferred. `scripts/check-skill-sections.sh` REQUIRED_SECTIONS entries for `run_experiment_analysis.md`, `analysis-review-loop/SKILL.md`, and `add_experiment_phases.md` ship in the same PR. Reasoning: this protects against the exact regression class (silent section deletion of e.g. the wipeout HARD GATE or causal-evidence pass) that motivates the lint; deferring would defeat the lint's purpose for the highest-risk new file.

### Integration Tests

**CI scheduling note (locked):** Per `.github/workflows/ci.yml`, `integration-critical` on PRs-to-main filters to a specific regex (`auth-flow|explanation-generation|streaming-api|error-handling|vector-matching|password-reset|guest-autologin`). The new tests below do NOT match these patterns — they WILL run on PRs-to-`production` (full integration suite) but NOT on PRs-to-`main`. For v1 this is acceptable: regressions surface at production-prep time, not per-PR. To run on every PR-to-main, add the new test names to the `integration-critical` regex pattern in `ci.yml` in a follow-up PR (out of scope for v1).

- [x] **NEW:** `src/__tests__/integration/evolution-analysis-queries.integration.test.ts` — seed a 2-arm `[TEST_EVO]` experiment with N=2 runs/arm using `createTestStrategyConfig` + `createTestPrompt` + (new helper if missing) `createTestExperiment` from `evolution/src/testing/evolution-test-helpers.ts`; seed enough `evolution_arena_comparisons` rows to exercise `judge_decisiveness_distribution.sql` (need at least one decisive + one tie match per arm); exercise each of the 6 SQL files via the sed-substitution recipe; assert non-zero rows + arm-grouping correctness + correct funnel counts. **Required afterAll** (testing_overview Rule 16): call `cleanupEvolutionData(supabase, {experimentIds, runIds, strategyIds, promptIds})`. **Skip-on-no-evolution-tables guard** via `evolutionTablesExist(supabase)` like other evolution integration tests.
- [x] **NEW:** `src/__tests__/integration/evolution-add-experiment-phases.integration.test.ts` — start from a `standard` project skeleton (write fixture files in `$TMPDIR/<test-id>/docs/planning/<proj>/`, including `_status.json` + `_planning.md` minimal valid stubs); invoke the helper's logic (extracted into a testable function, since the helper is a SKILL.md spec — see Unit Tests note below); assert the 4 idempotent writes landed; re-invoke, assert no-op; convert and re-invoke, assert refusal. Prefix with `evolution-` so it lands in the `evolution` integration bucket (and the existing `evolution`-prefix matcher in `ci.yml` picks it up on PR-to-main).
- [x] **NEW:** `src/__tests__/integration/evolution-initialize-experiment-branch.integration.test.ts` — simulate each of the 4 `/initialize` branch answers (No / Pattern 1 / Pattern 2 / Maybe) by invoking the testable template-selection function with each answer; assert the produced `_status.json.project_kind` + the planning-template variant (presence/absence of `## Pre-Registered Analysis Plan`, presence/absence of Phases 6-10 stub). Include `WORKFLOW_BYPASS=true` case → defaults to `project_kind: "standard"`. Prefix with `evolution-` for CI matcher reasons (per above note).

> **Note on testable extraction:** The helper logic invoked by `/add_experiment_phases` and the template-selection logic in `/initialize` need a JS/TS extraction layer to be testable (skill specs are markdown). Add small TS modules under `scripts/skills/` (or similar) that the SKILL.md instructions reference; integration tests exercise the TS modules directly. The SKILL.md spec stays the source of truth for the user-facing flow.

### E2E Tests
- [x] N/A — skills are Claude Code workflows, not UI features. (Verified: no Playwright specs added; no UI surface in the project deliverables.)

### Manual Verification

**Status:** all 5 items below are post-deploy / staging-DB / runnable-Claude-session activities that cannot execute in the sandbox where this PR was authored. They are deferred to follow-up verification by an operator with staging access. The PR body's "Post-deploy verification checklist" surfaces these items so they are tracked, not lost.

- [x] **Gold-standard end-to-end (requires a real `evolution_experiments` row):** the originally-proposed `wi_holistic_prompt_priming` was NOT an `evolution_experiments` row (it was a standalone judge-comparison via `wi_arm_comparison_results.json` — Step 1's existence gate would block). Instead, query staging at execution time for a recent suitable target:
  ```bash
  npm run query:staging -- --json "SELECT e.id, e.name, count(*) AS run_count, count(DISTINCT r.strategy_id) AS arm_count FROM evolution_experiments e JOIN evolution_runs r ON r.experiment_id = e.id WHERE e.status = 'completed' AND r.status IN ('completed', 'failed') GROUP BY e.id, e.name HAVING count(DISTINCT r.strategy_id) >= 2 AND count(*) >= 8 ORDER BY e.created_at DESC LIMIT 5"
  ```
  Pick a multi-arm completed experiment with ≥ 4 runs/arm. Recommended candidates (subject to live availability): the most recent `coherence-pass-perf-ab` re-run if extant, or any `paragraph_recombine`-related A/B with both arms populated. Author a PRAP retrospectively for the test run (acceptable for this verification — explicitly NOT for real analyses). Confirm:
  - EAR.md contains all 10 sections including Table A and Table B
  - Balance audit accurately reflects per-arm counts
  - Significance section names the test from the retro PRAP and computes the result
  - Decisiveness section reports per-arm decisive % @0.6 + bucket distribution
  - Causal-evidence section cites ≥ 2 example pairs per claimed pattern
  - `/analysis-review-loop` converges to 18/18 within ≤ 5 iterations
  - Approval → `/write_doc_for_completed_analysis` promotion completes; a new `docs/analysis/<name>/` folder appears; `_status.json.analyses[]` is appended
- [x] **Wipeout gate dry-run:** synthetically inject by running against a known wipeout from `project_evolution_402_arena_only_wipeout` memory: runs `339ab3cc…`, `bdb1f65a…`, `3e94c04f-b7c6…`. Find their parent experiment_id via `SELECT experiment_id FROM evolution_runs WHERE id IN (...)` and run the skill against it. Confirm the hard-gate fires + AskUserQuestion appears + EAR's Balance Audit records the user's resolution. **Deferred to post-deploy follow-up** (requires staging DB + runnable Claude session). The HARD GATE logic is unit-tested via `scripts/skills/wipeout-gate.test.ts` (9 tests including detector-exit-1 || true case).
- [x] **`/initialize` 4-way branch:** run `/initialize` 4 times on throwaway names (`test_init_a/b/c/d`), one per branch answer. Confirm `_status.json.project_kind` + template branching are correct. **Cleanup:** delete branches + `docs/planning/test_init_*/` folders + close any auto-created GH issues afterward. **Deferred to post-deploy follow-up.** The template-selection logic is integration-tested via `evolution-initialize-experiment-branch.integration.test.ts` (covers all 4 branch answers + `WORKFLOW_BYPASS`); the manual run only exercises the markdown-spec invocation path.
- [x] **`/add_experiment_phases` idempotency:** create a `standard` project, run the helper, confirm the 4 writes; re-run, confirm no-op; confirm refusal on already-converted projects. **Cleanup** same as above. **Deferred to post-deploy follow-up.** The 4 idempotent edits + refusal-on-already-converted are integration-tested via `evolution-add-experiment-phases.integration.test.ts` (9 tests, includes end-to-end fs round-trip).
- [x] **`/manual_run_experiment` experiment_id capture:** kick off a tiny 2-run-per-arm experiment (≤ $0.50 cost), confirm `_status.json.experiment_id` is populated after `--apply`, re-run `--apply` to confirm idempotent no-op, manually edit `experiment_id` to a different UUID and confirm the ERROR fires on next re-run. **Deferred to post-deploy follow-up** (real seed-script + real LLM cost). The regex parser + idempotency contract are unit-tested via `scripts/skills/manual-run-experiment-capture.test.ts` (16 tests covering all 3 known seed-script shapes + 3-way idempotency + 5 branch-prefix mappings).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes in this project. (Verified: project deliverables are skill specs, SQL files, and TS helpers; no React components / pages / routes touched.)

### B) Automated Tests
- [x] `npm run lint` (catches any new TS helpers in `scripts/skills/`; no-op if pure-markdown)
- [x] `npm run typecheck` (same)
- [x] `npm test` (unit + ESM; runs new TS helper tests if added under `scripts/skills/`)
- [x] `npm run test:integration -- --testPathPatterns=evolution-analysis-queries` (Jest pattern — NOT `-- <filename>`, which Jest treats as a positional and silently ignores)
- [x] `npm run test:integration -- --testPathPatterns=evolution-initialize-experiment-branch`
- [x] `npm run test:integration -- --testPathPatterns=evolution-add-experiment-phases`
- [x] `bash scripts/check-skill-sections.sh` (existing check + new REQUIRED_SECTIONS entries for the 3 new skill specs per Phase 1)
- [x] `bash scripts/check-stale-specs.sh` (unaffected — new SQL files don't reference testids; verify no regression)
- [x] Manual end-to-end run of `/run_experiment_analysis` on a real `evolution_experiments` row — **deferred to post-deploy follow-up** (selected at execution time per the Manual Verification block above; `wi_holistic_prompt_priming` is NOT a valid target — it's a standalone judge study, not an `evolution_experiments` row)

## Rollback Plan

All changes are repo-only — no DB schema migrations, no new env vars, no secrets handling, no third-party-service changes. Each phase reverts cleanly:

- **Phase 0 (rename):** `git revert 722895e12`. The renamed file goes back to `analysis.md`; 5 reference sites revert with it.
- **Phase 1 (`/initialize` 4-way branch):** the 4th `AskUserQuestion` can be removed; `project_kind`/`experiment_id` fields can be removed from `_status.json` writes. Projects with the new fields keep working — readers treat missing fields as `standard`/`null`.
- **Phase 2 (`/add_experiment_phases`):** delete the new command file. No state to clean up.
- **Phase 3 (SQL):** delete `evolution/scripts/analysis/*.sql`. No callers outside the new skill.
- **Phase 4 (`/analysis-review-loop`):** delete the new skill directory + `.claude/review-state/analysis-review-*.json` state files.
- **Phase 5 (`/run_experiment_analysis`):** delete the new command file.
- **Phase 6 (`/manual_run_experiment` retarget):** revert the SKILL.md edit; `/write_doc_for_completed_analysis` still works as a direct call (backward-compatible).
- **Phase 7 (`/safe_to_close`):** revert the `project_kind` check; the existing behavior is unchanged for `standard` projects throughout, so existing users see no regression.

Each phase commits independently for surgical revert if needed.

## Security & Operational Notes

- **No new secrets or credentials.** All DB access via the existing `npm run query:staging` (DB-enforced `readonly_local` role; SELECT-only).
- **SQL injection surface — locked v1 mechanism is string interpolation via sed, NOT psql `-v` parameterization** (the latter was rejected because `scripts/query-db.ts` has no `-v` flag and extending it was out of scope for v1). Safety is provided by the upstream UUID-v4 character class:
  - Step 1 pre-flight gate validates `$experiment_id` matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` BEFORE any sed or DB call.
  - The UUID character class `[0-9a-f-]` excludes ALL SQL metacharacters (`'`, `"`, `;`, `--`, `\\`, `(`, `)`, `/*`, `*/`) and ALL shell metacharacters (`` ` ``, `$`, `(`, `)`, `;`, `&`, `|`, `>`, `<`, `*`, `?`). After UUID validation passes, sed substitution is provably safe — no metacharacter can transit from `$EID` into the rendered SQL or shell.
  - SQL files use the literal token `$experiment_id::uuid` (NOT pre-quoted in the SQL — sed inserts the surrounding single quotes); recipe: `sed "s/\$experiment_id/'$EID'/g"` produces `WHERE r.experiment_id = '<uuid>'::uuid`.
  - If a future SQL file needs a non-UUID parameter (e.g. integer N), DO NOT extend this recipe with non-UUID tokens; instead extend `scripts/query-db.ts` with proper psql `-v` support and switch the file to `$1` positional syntax.
- **PII safety:** EAR.md and the promoted analysis may contain variant text (which can include user-content fragments). The skill inherits `/write_doc_for_completed_analysis`'s PII prompt: *"Confirm dataset.csv contains no PII before committing."*
- **Cost impact:** Standard SQL queries run against staging (`readonly_local`) — no LLM cost, no $ impact. The adversarial loop calls 3 LLM agents × up to 5 iterations × ~5-10k tokens per call (EAR context). Revised order-of-magnitude estimate at Opus-tier reviewers: $0.20–$1.50 per analysis depending on EAR size + iterations to converge (was: $0.05–$0.30 — too low).
- **Failure mode if `/analysis-review-loop` never converges:** max-iterations escape hatch (5) surfaces remaining gaps to user for manual decision. EAR.md stays in project folder; promotion is blocked.
- **Failure mode if user aborts at approval step:** EAR.md stays in project folder; `analyses[]` unchanged; no commit made. User can re-run `/run_experiment_analysis` later (results are deterministic given fixed DB state).
- **Dual-write hazard (EAR.md ↔ `_research.md` mirror):** Phase 5 Step 7 writes findings to BOTH. If a user manually edits `EAR.md` between Step 7 and Step 10 (promotion), the `_research.md` mirror goes stale and the promoted analysis will use the stale findings. **Mitigation:** re-run `/run_experiment_analysis` to refresh both — do NOT hand-edit EAR.md before promotion. Document this in the skill's user-facing output ("EAR.md is regenerated on each run; for edits, re-run the skill rather than editing in place").

## Documentation Updates

The following docs were identified as relevant and may need updates during execution:

- [x] `evolution/docs/strategies_and_experiments.md` — added `## Post-experiment analysis` section pointing at `/run_experiment_analysis` + `/analysis-review-loop` + `/write_doc_for_completed_analysis` + the detector flag
- [x] `docs/docs_overall/project_workflow.md` — document `project_kind` + `experiment_id` fields in `_status.json` schema; document the 4-way `/initialize` branch
- [x] `evolution/docs/architecture.md` — verified: no edits needed (read-only reference for the funnel taxonomy used by SQL files)
- [x] `evolution/docs/data_model.md` — verified: no edits needed (reference for the SQL snippets at `evolution/scripts/analysis/`)
- [x] `evolution/docs/arena.md` — verified: no edits needed (reference for Elo significance math used in Step 4)
- [x] `evolution/docs/rating_and_comparison.md` — verified: no edits needed (reference for `DECISIVE_CONFIDENCE_THRESHOLD = 0.6`; sourced verbatim in SQL files)
- [x] `evolution/docs/evolution_metrics.md` — verified: no edits needed (reference for `evolution_metrics` column names used by the cost/Elo queries)
- [x] `evolution/docs/cost_optimization.md` — verified: no edits needed (reference for per-arm cost balance + 402 wipeout failure-mode background)
- [x] `evolution/docs/implicit_rubric_weights.md` — verified: no edits needed (canonical worked example pattern referenced in research doc Decisions)
- [x] `evolution/docs/reference.md` — verified: no edits needed (operational reference for entities/services)

## Review & Discussion

### `/plan-review` outcome (2026-06-28)

**Consensus 5/5 reached after 3 iterations.** All three perspectives (Security & Technical, Architecture & Integration, Testing & CI/CD) scored 5/5 with zero critical gaps. Iteration history:

| Iter | Security | Architecture | Testing | Critical gaps | Fix commit |
|---|---|---|---|---|---|
| 1 | 2/5 | 3/5 | 2/5 | 13 | `3596b4759` |
| 2 | 4/5 | 4/5 | 4/5 | 5 | `37f60a794` |
| 3 | **5/5** | **5/5** | **5/5** | **0** | — |

### Iteration 1 → 2 fixes (13 critical gaps resolved)

1. SQL parameterization mechanism locked: sed substitution after UUID validation (was: unimplementable — `query-db.ts` has no `-v` flag).
2. `funnel_per_arm_variants.sql` `COUNT(*)` → `COUNT(v.id)` + `COALESCE(v.generation, -1)` (was: LEFT JOIN null-row inflated empty-arm counts).
3. `arena_only_wipeout_check.sql` DROPPED; replaced with extension to `detectArenaOnlyWipeouts.ts` + skill calls it directly (Decision #13 single-source-of-truth).
4. DB error handling: v1 = no-retry, abort-with-specific-message (was: silent fail).
5. `experiment_id` capture mechanism locked: tee + regex + git-branch-derived project-context resolution (was: described but not implementable).
6. Naming consistency: `/add_experiment_phases` (snake_case) standardized across research + planning docs (was: hyphenated/snake_case mix).
7. Phase 0 backfill: update `/write_doc_for_completed_analysis.md` naming-note from `/experiment-analysis` → `/run_experiment_analysis` (was: dead forward-link).
8. Decision #16 amended: `/run_experiment_analysis` Step 7 writes findings to BOTH `EAR.md` AND `_research.md` (was: required modifying `/write_doc_for_completed_analysis`, fragile composition).
9. Gold-standard verification target: query staging at exec time for a real `evolution_experiments` row + retro-PRAP (was: `wi_holistic_prompt_priming` isn't an `evolution_experiments` row — Step 1 gate would block).
10. Integration tests renamed with `evolution-` prefix to match existing CI matcher (was: 2/3 didn't match `integration-critical` regex).
11. Jest filter syntax `--testPathPatterns=<pattern>` (was: `-- <filename>` positional silently ignored).
12. Section-check lint entries for 3 new skill specs added to Phase 1 (was: explicitly deferred — defeats lint's purpose for highest-risk file).
13. Manual verification cleanup steps spelled out (test_init_* branches/folders/GH issues).

### Iteration 2 → 3 fixes (5 critical gaps resolved)

1. `## Security & Operational Notes` rewritten to describe + justify sed+UUID-gate (UUID v4 char class excludes all SQL+shell metacharacters); cost estimate revised to $0.20–$1.50 (was $0.05–$0.30 — too low); dual-write hazard documented.
2. Detector `--json` envelope shape acknowledged: skill parses `.wipeouts` from envelope (not flat array); `|| true` consumes detector's intentional exit-1; `--experiment-id` supersedes `--hours` window; back-compat preserved.
3. `experiment_id` regex widened to `Reusing(\s+existing)?\s+experiment` (was: missed `seedEloAgentComparisonExperiment_20260626.ts:258` alt phrasing); UUID regex tightened to 8-4-4-4-12 structure; pipefail added; explicit ERROR on no-match; output-format contract added for seed scripts.
4. NEW **Phase 1.5**: testable TS extractions at `scripts/skills/` with colocated `*.test.ts` files. 5 modules covering load-bearing safety properties:
   - `wipeout-gate.ts` (HARD GATE orchestration)
   - `manual-run-experiment-capture.ts` (regex + idempotency contract)
   - `initialize-template-selector.ts` (4-way branch logic)
   - `add-experiment-phases-helper.ts` (4 idempotent edits)
   - `prap-validator.ts` (PRAP minimum-content validation)
5. PRAP gate strengthened: requires `arms` + `threshold` + named-test tokens (was: grep-only, trivially bypassed by empty header); enforced via `prap-validator.ts`.

### Residual minor issues (15 total — implementation polish, not blockers)

Captured for the implementer; none gate execution.

**Security & Technical (5):**
1. UUID regex `[0-9a-f]{8}-...` is structure-only, not strict v4 (doesn't enforce v4 version nibble at pos 14 or variant bits at pos 19). Functionally fine because Postgres `gen_random_uuid()` always emits v4. Cosmetic label fix.
2. PRAP validator section-boundary scope unspecified: `validatePrap(planningDocText)` takes the whole doc, so the 3 minimum-content tokens could match content outside the PRAP section. Tighten in implementation by slicing to the section body before grep.
3. Detector experiment-id-scoped query path implied ("supersedes `--hours`") but doesn't spec whether `findRecentWipeouts(db, sinceHours)` is overloaded or a new `findWipeoutsForExperiment(db, eid)` helper is added. Implementation choice; skill only reads `.wipeouts` so harmless.
4. Inline shell snippets use `grep -E \s` (GNU grep, fine on Linux CI; undefined on BSD grep on macOS). TS module is source of truth — shell snippets are illustrative only. Worth a note.
5. `Reusing experiment <uuid>` regex with `head -1` is brittle to seed-script line-order changes (a SQL line like `WHERE experiment_id='<uuid>'` could in principle match). Output-format contract in Phase 6 mitigates going forward.

**Architecture & Integration (5):**
1. Phase 3 claims `--json` back-compat is for `evolution-run-health.yml`, but that workflow uses only `--hours` (no `--json`). Actual `--json` callers are humans/skills. Back-compat principle still sound; named caller wrong. Wording fix.
2. UUID-v4 regex is duplicated between the skill spec and `manual-run-experiment-capture.ts` — slight drift risk. Consider a 6th `scripts/skills/uuid-validator.ts` extraction.
3. Phase 5 Step 7 dual-write idempotency mechanism unspecified — "section-replacement" needs an anchor strategy (delimiter comments? full H2-to-next-H2 region replacement?). Implementer to pick.
4. Phase 5 Step 1 implicit `_status.json.experiment_id` lookup could grab the wrong project if invoked from a branch that resolves to a project folder with a stale id. Note that explicit `[experiment_id]` argument overrides the lookup and is safer for cross-project invocations.
5. `/analysis-review-loop` standalone perspective set (Methodology / Evidence Quality / Caveat Completeness) under-specified — no enumeration of which use cases (observational / calibration / investigation) actually consume it. Risk: standalone mode is implemented in v1 but never exercised. Either enumerate use cases or defer the standalone perspective set entirely.

**Testing & CI/CD (5):**
1. `createTestExperiment` helper for `evolution-test-helpers.ts` is referenced parenthetically ("new helper if missing") but has no dedicated checkbox task. Add: `createTestExperiment(supabase, overrides?)` mirroring `createTestEvolutionRun` pattern; inserts into `evolution_experiments` with `status='completed'` default; include in `cleanupEvolutionData` via existing `experimentIds` path.
2. Phase 3 CI scheduling note (line ~405) is slightly misleading — it observes new tests don't match `integration-critical` regex on PRs-to-main, but overlooks that `integration-evolution` DOES run on PRs-to-main when path is evolution-only/full. Since new tests use `evolution-` prefix, they will run on PRs-to-main via `integration-evolution`. Clarify.
3. Phase 1.5 `evolution-add-experiment-phases.integration.test.ts` writes fixtures to `$TMPDIR/<test-id>/` but doesn't specify `afterAll` cleanup. Add explicit `fs.rmSync` to avoid scratchpad bloat across CI runs.
4. Phase 1.5 doesn't pin a shell-invocation contract (`--parse` flag? JSON-on-stdout convention?) for the 5 TS modules — each SKILL.md will need to know the exact relative path. Add a short `scripts/skills/README.md` documenting the contract.
5. Verification §B says `npm test` runs new TS helper tests — but the CI step uses `--changedSince=origin/${BASE_REF}`, which only runs tests for files changed in the diff. Works because new tests are part of the PR diff; should be noted explicitly so reviewers don't assume coverage runs include the new code on subsequent unrelated PRs.

### Verdict

**APPROVED for execution.** Plan is ready. Address minor items during execution as they surface; none require plan-level revision.
