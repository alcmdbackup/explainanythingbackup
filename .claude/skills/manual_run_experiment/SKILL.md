---
name: manual_run_experiment
description: >
  Run a controlled staging A/B (or multi-arm) experiment for the evolution
  pipeline end-to-end: reuse existing seed-script infrastructure when possible,
  enforce production cost tracking, wait for the runs to complete, trigger
  /run_experiment_analysis (which transparently invokes /write_doc_for_completed_analysis
  on user approval), and create a PR with the script + analysis.
  Use when the user wants to validate a hypothesis with N runs/arm on staging,
  test a new agent/config against a baseline, or kick off a comparison study.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - TodoWrite
  - AskUserQuestion
---

# Manual Run Experiment Skill

End-to-end workflow for kicking off a manual staging experiment: scaffold or
reuse a seed script, fire runs through the production cost-tracking pipeline,
wait for completion, analyze the results, and ship a PR with the analysis +
script.

## When This Skill Triggers

- "Run a staging A/B for X" / "kick off N runs/arm to test Y"
- "Validate hypothesis X with a controlled experiment"
- "Compare config A vs config B in production traffic"
- Post-merge of any change to evolution agent code that the user wants to
  validate against a baseline

## Hard Requirements

These are non-negotiable. Failing any of them is a runtime abort:

1. **Cost tracking via production infrastructure.** The seed script MUST use
   `upsertStrategy + createExperiment + addRunToExperiment` from
   `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` and
   `evolution/src/lib/pipeline/manageExperiments.ts`. These route LLM calls
   through `createEvolutionLLMClient` → `recordSpend` → `llmCallTracking` rows.
   **NEVER bypass with direct LLM API calls, raw SQL inserts to `evolution_runs`,
   or test/mock LLM clients.** The whole point of staging A/B is real-traffic
   cost-tracked validation.

2. **Dated filenames for new scripts.** Any new script under
   `evolution/scripts/experiments/` must have a date suffix:
   `seed<ExperimentName>Experiment_YYYYMMDD.ts`. Multiple A/Bs of the same
   idea over time need distinguishable filenames.

3. **PR at the end.** When runs complete and analysis is written, create a PR
   containing the script (if new) + the analysis report + any planning-doc
   pointer updates. Don't leave the analysis uncommitted.

## Workflow

### Step 1 — Read existing scripts

```bash
ls evolution/scripts/experiments/
cat evolution/scripts/experiments/README.md
```

Read every `seed*.ts` file in that folder + the parent `seedBundleSplitExperiment.ts`
(the reference pattern). Understand:
- Argument conventions (`--target {staging|prod}`, `--runs-per-arm`, `--apply`,
  `--append`, `--reuse-existing`).
- How `upsertStrategy` + `createExperiment` + `addRunToExperiment` are composed.
- How the prod gate works (`--i-know-this-is-prod` for staging-only prompts).

### Step 2 — Decide reuse vs new

| Situation | Action |
|---|---|
| Same agent + same config shape as an existing script | **Reuse**. Run with `--append` to add more runs to the same experiment row, OR rerun with `--runs-per-arm M` for a fresh experiment row. |
| Same agent, different config (e.g. new knob being tested) | **New script**. Clone the closest existing script as a template. |
| New agent type | **New script** from `seedBundleSplitExperiment.ts` (the most general template). |

When unsure, ask the user via `AskUserQuestion`.

### Step 3 — Pull baseline settings from recent comparable runs

Before deciding the experiment config, query staging for the most recent
comparable strategy:

```bash
npm run query:staging -- --json "SELECT id, name, config FROM evolution_strategies WHERE config::text ILIKE '%<agent_type>%' ORDER BY created_at DESC LIMIT 5"
```

Default the experiment's Control arm to those settings unless the user
explicitly overrides. Document the source strategy id in the script's header
comment so the comparison is traceable.

### Step 4 — Author or update the seed script

If new, place at `evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts`.
Follow the `seedBundleSplitExperiment.ts` pattern exactly. Required structure:

```typescript
// 1. Constants — PROMPT_ID, EXPERIMENT_NAME, BUDGET_USD_PER_RUN
// 2. Arg parsing — --target / --runs-per-arm / --apply / --append / --reuse-existing
// 3. validateArgs() — guards --target prod for staging-only prompts
// 4. buildConfig(arm) — both arms explicitly pin the field-under-test so config_hash
//    is distinct from any pre-existing strategy AND robust to env-var kill switches
// 5. buildDb(target) — loads .env.local (staging) or .env.evolution-prod
// 6. seedStrategy(arm, cfg, db, reuseExisting) — collision guard via config_hash
// 7. main() — dry-run by default, --apply writes
```

Then update `evolution/scripts/experiments/README.md` to add the new script to
the Index table.

Add to the project's planning doc (under an `## Artifacts` section, before
`## Review & Discussion`) a pointer to the script + the experiment+strategy ids
produced by the first --apply.

### Step 5 — Dry-run, then apply (with experiment_id capture)

```bash
npx tsx evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts \
  --target staging --runs-per-arm 8

# Verify the planned writes look right, then run with --apply.
# Use tee + pipefail to capture stdout for experiment_id extraction
# (extraction is testable: scripts/skills/manual-run-experiment-capture.ts).
set -o pipefail
SEED_OUT=$(mktemp)
npx tsx evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts \
  --target staging --runs-per-arm 8 --apply | tee "$SEED_OUT"
# pipefail is REQUIRED — without it, a failed seed-script silently produces
# empty $SEED_OUT and the standalone-skip path misleads the user.

# Extract experiment_id (handles all 3 known seed-script output shapes:
# "experiment_id = <uuid>" / "Reusing existing experiment <uuid>" /
# "Reusing experiment <uuid>"):
EID=$(npx tsx scripts/skills/manual-run-experiment-capture.ts extract "$SEED_OUT")
if [ -z "$EID" ]; then
  echo "ERROR: could not extract experiment_id from seed-script output." >&2
  exit 2
fi
echo "Captured experiment_id = $EID"
```

**experiment_id write to `_status.json`** (per /run_experiment_analysis Phase 6 design):

```bash
# Resolve project folder from current branch (strips feat/, fix/, chore/, docs/, hotfix/).
BRANCH=$(git branch --show-current)
PROJECT_DIR=$(npx tsx scripts/skills/manual-run-experiment-capture.ts resolve-folder "$BRANCH")
if [ -z "$PROJECT_DIR" ] || [ ! -f "$PROJECT_DIR/_status.json" ]; then
  echo "WARNING: no project folder resolved for branch '$BRANCH'." >&2
  echo "         Captured experiment_id=$EID but skipping _status.json write." >&2
  echo "         Pass [experiment_id] explicitly when invoking /run_experiment_analysis." >&2
else
  # Idempotency contract: absent/null → write, equal → noop, differs → ERROR.
  CURRENT=$(jq -r '.experiment_id // "null"' "$PROJECT_DIR/_status.json")
  ACTION=$(npx tsx scripts/skills/manual-run-experiment-capture.ts idempotency "$CURRENT" "$EID")
  case "$ACTION" in
    write|noop)
      jq --arg eid "$EID" '.experiment_id = $eid' "$PROJECT_DIR/_status.json" > "$PROJECT_DIR/_status.json.tmp"
      mv "$PROJECT_DIR/_status.json.tmp" "$PROJECT_DIR/_status.json"
      echo "✓ Wrote experiment_id=$EID to $PROJECT_DIR/_status.json (action: $ACTION)"
      ;;
    error)
      echo "ERROR: Project already has experiment_id=$CURRENT recorded." >&2
      echo "       Either you're running a different experiment for this project" >&2
      echo "       (use a new project via /initialize), or the previous experiment" >&2
      echo "       was wrong (manually clear _status.json.experiment_id and re-run)." >&2
      exit 1
      ;;
  esac
fi
```

Capture the printed strategy ids too — they'll appear in the planning doc's `## Artifacts` section.

### Step 6 — Wait for completion

Poll `evolution_runs` until `status='pending'` count = 0. The minicomputer
evolution-runner picks up queued runs automatically (no manual trigger needed)
**provided the minicomputer has pulled the latest main**. If runs sit pending
for >5 minutes after queueing, remind the user to run on the minicomputer:

```bash
git -C /home/ac/Documents/ac/explainanything-worktree0 pull --ff-only origin main
```

Poll pattern (cache-friendly intervals):

```bash
until [ "$(npm run query:staging -- --json "SELECT count(*) AS n FROM evolution_runs WHERE experiment_id='<EXP_ID>' AND status IN ('pending','claimed','running')" 2>/dev/null | grep -oE '"n":\s*"?[0-9]+' | grep -oE '[0-9]+')" = "0" ]; do sleep 120; done
```

Then summarize per-arm completion:

```bash
npm run query:staging -- --json "SELECT s.name, r.status, count(*) FROM evolution_runs r JOIN evolution_strategies s ON s.id=r.strategy_id WHERE r.experiment_id='<EXP_ID>' GROUP BY s.name, r.status"
```

If any runs `failed`, surface those (`error_code`, `error_message`) before
proceeding to analysis — failures pollute the comparison.

### Step 7 — Trigger /run_experiment_analysis

Invoke the `/run_experiment_analysis [experiment_id]` skill for the project this experiment belongs to (resolves `experiment_id` from `_status.json.experiment_id` set in Step 5). That skill runs:

1. **Pre-flight gates** — PRAP-content validation, UUID validation, `experiment_id` existence in `evolution_experiments`.
2. **Funnel/balance audit** — 6 SQL queries from `evolution/scripts/analysis/`.
3. **Arena-only wipeout HARD GATE** — calls `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id`. Refuses to compute significance if any wipeouts detected; AskUserQuestion to resolve (drop / rerun / proceed with caveat).
4. **Significance computation** — per the named statistical test in `_planning.md ## Pre-Registered Analysis Plan` (Mann-Whitney / McNemar / Spearman / Bootstrap / permutation).
5. **Judge-decisiveness audit** — per-arm decisive % @0.6 + full confidence bucket distribution + position-bias %.
6. **Causal-evidence pass** — refuses to ship pattern claims with <2 concrete examples.
7. **Writes EAR.md** to `docs/planning/<project>/EAR.md` with all 10 required `##` sections including Table A (Test-vs-Control Metrics) + Table B (Experimental Validity Funnel).
8. **Adversarial 5/5 review loop** via `/analysis-review-loop` (per-section scoring across 3 reviewers × 6 sections = 18 cells).
9. **User approval gate** — review EAR.md, approve / fix-then-promote / abort.
10. **Transparent promotion** on approval → invokes `/write_doc_for_completed_analysis <project>` (Step 3 findings-picker against `_research.md ## Key Findings` which was mirrored from EAR in Step 7).

The PRAP section in `_planning.md` MUST be filled in BEFORE invoking this skill (the skill's Step 1 gate refuses without it). Required PRAP content (per `scripts/skills/prap-validator.ts`): `arms` + `threshold` + a named test (Mann-Whitney / McNemar / Bootstrap / Spearman / permutation). For projects created without PRAP (project_kind=standard), run `/add_experiment_phases` first to convert.

The final promoted analysis at `docs/analysis/<name>/<name>.md` (written by the downstream `/write_doc_for_completed_analysis` skill) inherits its 5-section template via the EAR's first 5 sections — Header / Methodology / Key Findings / Dataset / Queries & Results.

### Step 8 — Create PR

PR contents:
- The seed script (new or modified) under `evolution/scripts/experiments/`
- The README index entry update
- The analysis report folder under `docs/analysis/<analysis-name>/`
- Any planning-doc updates (Artifacts section, Review & Discussion updates)

PR title: `analysis: <experiment short name> A/B results`
PR body must reference:
- The triggering project's planning doc
- The experiment id + arm strategy ids
- The decision-rule outcome (PASS / FAIL / INCONCLUSIVE)
- Cost spent ($/run, total $)

After the PR is created, drop the URL into the response so the user can monitor.

## Anti-Patterns (NEVER do these)

- **Mocking LLM calls in the seed script.** Production cost tracking requires
  real LLM calls. If you mock, `llmCallTracking` doesn't fire and the run's
  spend is wrong.
- **Direct `INSERT INTO evolution_runs`** to queue runs. This bypasses
  `addRunToExperiment` which wires the experiment_id binding + the run-creation
  invariants. Use the API.
- **Writing the analysis as a comment on the planning doc**. Analysis goes in
  `docs/analysis/<name>/` (per `/write_doc_for_completed_analysis` skill). The planning doc just gets
  a pointer in its Artifacts section.
- **Shipping without the PR.** The whole point is durability — if the script
  and analysis aren't merged, they evaporate when the branch dies.
- **Reusing settings without saying so.** If the experiment is based on a
  recent comparable run's config, name the source strategy id in the script's
  header AND in the analysis methodology so the lineage is auditable.

## Related

- Reference seed script: `evolution/scripts/seedBundleSplitExperiment.ts`
- Experiments folder + index: `evolution/scripts/experiments/README.md`
- Cost tracking deep dive: `evolution/docs/cost_optimization.md` (search for
  `recordSpend`, `AgentCostScope`)
- Rigorous analysis skill: `/run_experiment_analysis <project-name>` (produces EAR.md + adversarial 5/5 review)
- Promotion skill: `/write_doc_for_completed_analysis <project-name>` (writes the durable artifact to `docs/analysis/<name>/`; invoked transparently by `/run_experiment_analysis` Step 10)
- Sub-skill: `/analysis-review-loop` (adversarial loop used by `/run_experiment_analysis` Step 8)
- Mid-cycle conversion: `/add_experiment_phases` (converts a `standard` project to `feature_with_experiment` so the PRAP gate passes)
- Project workflow: `docs/docs_overall/project_workflow.md`
