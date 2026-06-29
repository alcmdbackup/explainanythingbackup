---
name: run_experiment_analysis
description: >
  Produce a rigorous, adversarially-validated Experiment Analysis Report (EAR)
  from a completed multi-arm evolution experiment. Pre-flight gates (PRAP +
  arena-only wipeout HARD GATE), funnel/balance audit, named statistical test
  per PRAP, judge-decisiveness audit, causal-evidence pass, per-section 5/5
  adversarial review via /analysis-review-loop, user approval, transparent
  handoff to /write_doc_for_completed_analysis for promotion. Use when you've
  completed a controlled evolution experiment and need to analyze it.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - AskUserQuestion
  - TodoWrite
---

# /run_experiment_analysis - Rigorous Experiment Analysis

Production skill (NOT a promotion skill — see `/write_doc_for_completed_analysis` for that). Produces an Experiment Analysis Report (EAR) by querying the DB, computing statistics, surfacing concrete examples, and validating via a per-section adversarial review loop. On user approval, transparently hands off to `/write_doc_for_completed_analysis` for promotion to `docs/analysis/<name>/`.

## Workflow

```
/run_experiment_analysis [experiment_id]
   ↓
Step 1: Pre-flight gates (fail-closed, ordered)
   ↓
Step 2: Funnel/balance audit (6 SQL queries)
   ↓
Step 3: Arena-only wipeout HARD GATE (TS detector)  ← USER may need to resolve
   ↓
Step 4: Significance computation per PRAP-named test
   ↓
Step 5: Judge-decisiveness audit
   ↓
Step 6: Causal-evidence pass
   ↓
Step 7: Write EAR.md to project folder + mirror to _research.md
   ↓
Step 8: Adversarial 5/5 review loop (/analysis-review-loop)
   ↓
Step 9: User approval gate
   ↓
Step 10: Transparent promotion via /write_doc_for_completed_analysis
```

## Usage

```
/run_experiment_analysis [experiment_id]
```

- `experiment_id` (optional): UUID of the bound experiment. If omitted, resolves from `_status.json.experiment_id` of the current project (set by `/manual_run_experiment` after `--apply`).

## Pre-flight Gates

Step 1 runs these checks in order. All gates are fail-closed — any failure aborts the skill with a specific error message naming the violated condition.

1. **`_status.json` must exist and parse.** Error: *"Run `/initialize` first."*
2. **`_status.json.project_kind` must NOT be `"standard"`.** Error: *"Project not configured for experiments. Run `/add_experiment_phases` to convert."*
3. **`_planning.md` must contain a `## Pre-Registered Analysis Plan` section** (header check). Error: *"PRAP required; add `## Pre-Registered Analysis Plan` to `_planning.md`."*
4. **PRAP body must pass `prap-validator.ts`** (minimum-content tokens: `arms` + `threshold` + named test). Error: *"PRAP missing required content: [list]. The analysis plan must be specific enough to enable reproducible analysis."*
5. **`experiment_id` must resolve.** Error: *"Pass `[experiment_id]` or run `/manual_run_experiment --apply` first."*
6. **`experiment_id` must parse as UUID v4** (regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`). This validation MUST run BEFORE any sed/DB call. Bounds the SQL/shell injection surface to UUID character class.
7. **`experiment_id` must exist in `evolution_experiments` table.** Error names the failed query + suggests `npm run query:staging` for manual verification.
8. **Warn (not refuse) if `evolution_experiments.status NOT IN ('completed', 'cancelled')`** — analyzing a `draft` or `running` experiment is suspicious; require user confirmation via `AskUserQuestion` before proceeding.

### Gate invocations (testable extractions)

```bash
# Gate 4: PRAP validator
PRAP_RESULT=$(npx tsx scripts/skills/prap-validator.ts "$PROJECT_DIR/${PROJECT_NAME}_planning.md")
PRAP_VALID=$(echo "$PRAP_RESULT" | jq -r '.valid')
if [ "$PRAP_VALID" != "true" ]; then
  MISSING=$(echo "$PRAP_RESULT" | jq -r '.missingMarkers | join(", ")')
  echo "ERROR: PRAP missing required content: $MISSING"
  exit 1
fi

# Gate 6: UUID validation (delegates to manual-run-experiment-capture.isValidUuid)
if ! npx tsx -e "
  const { isValidUuid } = require('./scripts/skills/manual-run-experiment-capture');
  process.exit(isValidUuid(process.argv[1]) ? 0 : 1);
" "$EID"; then
  echo "ERROR: experiment_id must be a valid UUID v4"
  exit 1
fi
```

## Execution Steps

### Step 2 — Funnel/Balance Audit

Run the 6 SQL files at `evolution/scripts/analysis/*.sql` via sed substitution (per Phase 3 of the project plan):

```bash
for f in evolution/scripts/analysis/{funnel_per_arm_variants,funnel_per_arm_invocations,funnel_per_arm_decisive_matches,funnel_per_arm_top_elo_gain,judge_decisiveness_distribution,per_arm_cost_breakdown}.sql; do
  QUERY=$(sed "s/\$experiment_id/'$EID'/g" "$f")
  echo "=== $(basename $f .sql) ==="
  npm run query:staging -- --json "$QUERY"
done
```

Aggregate results into the `## Balance Audit` section of the EAR (Table B — Experimental Validity Funnel: rows per arm; columns: runs_queued, runs_completed, invocations_total, invocations_success, invocations_failed, invocations_skipped, variants_produced, variants_synced_to_arena, matches_played, matches_decisive).

**Cross-arm imbalance flag:** if any column varies > ~15% across arms, flag in a `### Balance Notes` subsection. Reviewer for Balance section may downgrade the score if unflagged imbalances are present.

### Step 3 — Arena-Only Wipeout HARD GATE

Call the canonical TS detector — do NOT use a SQL fingerprint (per Decision #13 — single source of truth):

```bash
# `|| true` consumes the detector's intentional exit-1 on wipeouts-found.
# We infer wipeouts from .wipeouts being non-empty, NOT from exit code.
WIPEOUT_JSON=$(npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id "$EID" --json || true)
# Parse via the testable extraction (covered by 9 unit tests in wipeout-gate.test.ts).
WIPEOUT_RESULT=$(npx tsx scripts/skills/wipeout-gate.ts "$WIPEOUT_JSON")
WIPEOUT_COUNT=$(echo "$WIPEOUT_RESULT" | jq -r '.count')
```

If `$WIPEOUT_COUNT > 0`:

1. Surface affected runs at the top of `## Balance Audit` with a clear callout: *"⚠ N runs match the arena-only wipeout fingerprint (variants=0, cost=0, generations>0 OR error_code=all_generations_failed). These runs are statistical garbage and should be excluded from significance computation, or the analysis is invalid."*
2. `AskUserQuestion`: **4 options** —
   - **drop these runs** (continue analysis excluding them)
   - **rerun the affected arm** (skill prints `/manual_run_experiment --append` invocation hint + aborts; user re-runs the skill once arm is re-seeded)
   - **proceed with explicit caveat** (continue; EAR's Balance Audit records the user's choice + adds a warning to all derived metrics)
   - **abort** (exit without writing EAR)
3. Record the user's choice + affected run IDs in EAR's `## Balance Audit` under `### Wipeout Resolution`.

### Step 4 — Significance Computation

Parse the named statistical test from the PRAP. Common tests + when to use them:

- **Mann-Whitney U one-sided** — per-run median deltas (used by coherence-pass-perf-ab)
- **McNemar (paired)** — verdict-flip rates (used by wi_holistic_prompt_priming)
- **Spearman ρ** — rank correlation between arms (also used by wi_holistic_prompt_priming for inverted-vs-aligned arm comparison)
- **Bootstrap CI** — confidence intervals on Elo deltas or weight vectors
- **Permutation test** — non-parametric alternative when sample sizes are small

For each claim in the PRAP, compute the test and report:
- Test statistic + p-value or CI bounds
- Comparison against PRAP threshold (e.g. *"MW p = 0.04 < 0.10 threshold → PASS criterion (1/3)"*)
- Verdict: PASS / FAIL / INCONCLUSIVE per the PRAP's combined rule

**Multi-criterion handling (Decision #14):**
- If PRAP specifies an aggregation rule (e.g. *"PASS iff ≥3 of 5 criteria show median shift ≥ +5 μ"*) → apply it AND report per-criterion.
- If PRAP doesn't specify an aggregation rule → report per-criterion only, NO aggregate verdict. The Statistical Validity reviewer will flag missing aggregation rules when the experiment shape warranted one.
- **Never auto-apply Bonferroni or BH.** Multiplicity correction is opt-in via PRAP, not imposed.

Output goes to EAR's `## Methodology` (test names + threshold reasoning) and `## Key Findings` (Table A — Test-vs-Control Metrics Summary with significance verdict column).

### Step 5 — Judge-Decisiveness Audit

Run `judge_decisiveness_distribution.sql` (already exercised in Step 2) and surface:

- **Per-arm decisive %** (confidence ≥ 0.6, winner ≠ 'draw') — sourced from `DECISIVE_CONFIDENCE_THRESHOLD` in `evolution/src/lib/shared/rating.ts`.
- **Full bucket distribution** per arm (1.0 / 0.7 / 0.5-TIE / 0.3 / 0.0).
- **Position-bias %** from 2-pass reversal data — if `evolution_arena_comparisons` includes `chain_depth`/`aggregation_rule` indicating 2-pass.

Output goes to EAR's `## Decisiveness Audit`. Strong asymmetries (e.g. one arm with 80% decisive, another with 30%) are flagged — they may invalidate cross-arm comparisons.

### Step 6 — Causal-Evidence Pass

For each claimed pattern in the analysis:
- **Surface ≥2 concrete examples** as evidence — variant IDs + invocation IDs + a brief snippet showing the pattern.
- **Refuse to ship pattern claims with zero example references.** Block until either evidence is added or the claim is downgraded to *"anecdotal / single example"* in the EAR.
- Use the language *"This pattern was observed in [N] of [M] examples (e.g. variant `<uuid>`, invocation `<uuid>`)"* — never *"For example, variant X did Y"* without an explicit "of M examples" framing.

Output goes to EAR's `## Causal Evidence`. Reviewer for Causal Evidence will downgrade if anecdotes pose as claims.

### Step 7 — Write EAR.md + Mirror to _research.md

Write `docs/planning/<project>/EAR.md` using the template below. ALSO append a summary to `_research.md` so `/write_doc_for_completed_analysis` Step 3 (findings-picker) works unchanged:

- `_research.md ## High Level Summary` — paste/replace with EAR's 3-5 sentence summary.
- `_research.md ## Key Findings` — mirror EAR's `## Key Findings` numbered list verbatim.
- Both writes are idempotent (re-running the skill replaces these sections; does NOT duplicate).

**Dual-write hazard mitigation:** do NOT hand-edit EAR.md between Step 7 and Step 10. Re-run the skill to refresh both. The skill prints this warning in its Step 7 output.

## EAR Output Template

The EAR.md at `docs/planning/<project>/EAR.md` MUST contain these 10 `##` sections in this order. The first 5 mirror `/write_doc_for_completed_analysis`'s required template so promotion is a copy-not-transform. The last 5 are experiment-specific.

```markdown
# <Project Name> — Experiment Analysis Report (EAR)

## Header
- **Project:** docs/planning/<project>/
- **Branch:** <branch>
- **Experiment ID:** <uuid>
- **Date:** <YYYY-MM-DD>
- **Skill version:** /run_experiment_analysis@<commit-sha>

## Methodology
[Named statistical test from PRAP + threshold reasoning + outlier-rule application.
Cite PRAP location: docs/planning/<project>/<project>_planning.md ## Pre-Registered Analysis Plan]

## Key Findings
[Numbered list. Each finding cites concrete data. Include Table A:
Test-vs-Control Metrics Summary (per arm rows; columns:
n_runs_completed, top_elo, median_elo, top_elo_delta_vs_control,
total_cost_usd, cost_per_improver_usd, significance_verdict).]

### Follow-up Ideas
[Numbered. What would improve the next iteration of this analysis?]

## Dataset
[Reference to dataset.csv (or sample.csv + full row count when over the
~1MB/10k cap, per inherited /write_doc_for_completed_analysis convention).
Note PII handling: "Confirm dataset.csv contains no PII before committing."]

## Queries & Results
[Every query used + raw results. Include the 6 standard SQL queries
parameterized on experiment_id + the wipeout-detector invocation.]

## Pre-Registered Analysis Plan
[Quote the PRAP verbatim from _planning.md. Note any deviations from the
plan (e.g. dropped runs per Step 3 wipeout resolution) explicitly.]

## Balance Audit
[Table B — Experimental Validity Funnel: per arm rows; columns:
runs_queued, runs_completed, invocations_total, invocations_success,
invocations_failed, invocations_skipped, variants_produced,
variants_synced_to_arena, matches_played, matches_decisive.]

### Wipeout Resolution
[Per Step 3 — if wipeouts detected, the user's choice (drop / rerun /
proceed with caveat) and affected run IDs.]

### Balance Notes
[Any cross-arm imbalance > ~15% on any column, with explanation.]

## Decisiveness Audit
[Per-arm decisive % @0.6, full bucket distribution (1.0 / 0.7 / 0.5-TIE
/ 0.3 / 0.0), position-bias % from 2-pass reversals if available.]

## Causal Evidence
[For each claimed pattern, ≥2 concrete examples (variant IDs + invocation
IDs + brief snippet). Framed as "observed in N of M examples", never
standalone anecdotes.]

## Adversarial Review Log
[Populated by /analysis-review-loop. Per-iteration: reviewer scores
(18-cell grid), critical_gaps, fixes applied. Final summary appended on
loop termination.]
```

### Step 8 — Adversarial Review

Invoke `/analysis-review-loop` with the EAR as target:

```
/analysis-review-loop --target=docs/planning/<project>/EAR.md --perspective-set=from-experiment-analysis
```

Block until convergence (18/18 cells = 5) or max-iterations escape hatch. The review loop appends its own audit trail to EAR's `## Adversarial Review Log`.

### Step 9 — User Approval Gate

`AskUserQuestion`: *"EAR is ready at `<path>` (reviewed 18/18). Approve to promote to `docs/analysis/`?"*

Options:
- **approve and promote** — proceeds to Step 10.
- **fix-then-promote** — user manually edits EAR.md, then re-invokes the skill (which re-runs Steps 7-9). Note the dual-write hazard.
- **abort** — keep EAR.md in project folder; `analyses[]` unchanged; no commit made.

### Step 10 — Transparent Promotion

On approval, invoke `/write_doc_for_completed_analysis`:

```
/write_doc_for_completed_analysis <project>
```

That skill runs its existing Step 3 findings-picker against `_research.md ## Key Findings` (which now mirrors EAR's findings per Step 7) and writes to `docs/analysis/<name>/<name>.md` with `dataset.csv` + `queries.sql`. Bidirectional provenance (`_status.json.analyses[]` + `_research.md ## Promoted Analyses`) is wired automatically.

The EAR.md in the project folder stays in place as the working/archive copy. Print both paths.

## Related

- Upstream: `/manual_run_experiment` Step 7 invokes this skill after run completion.
- Downstream: `/write_doc_for_completed_analysis` promotes EAR findings to `docs/analysis/<name>/`.
- Sub-skill: `/analysis-review-loop` provides the per-section adversarial 5/5 review (Step 8).
- Helper: `/add_experiment_phases` converts a `standard` project to `feature_with_experiment` if you need to add the PRAP section + experiment phases mid-cycle.
- Project design: `docs/planning/experiment_analysis_skill_20260628/` (18 locked decisions; 3-iteration plan-review consensus).
