# /add_experiment_phases - Convert a Standard Project to feature_with_experiment

Converts a `standard`-kind project (created by `/initialize` with answer A or D) into a `feature_with_experiment`-kind project (Pattern 3 mid-cycle conversion, per Decision #17 of the experiment-analysis project plan). Use when you started a project intending no experiment but later decided the change needs experimental validation.

## Usage

```
/add_experiment_phases [project-name]
```

- `project-name` (optional): project name or partial match. If omitted, resolves by the current git branch (like `/research` / `/run_experiment_analysis`).

## Pre-conditions

The skill REFUSES to run when any of these are violated. All checks are fail-closed.

- [ ] Project folder must exist at `docs/planning/<project>/`.
- [ ] `_status.json` must be readable.
- [ ] `_status.json.project_kind` must currently be `"standard"`.
  - If `"feature_with_experiment"` → refuse (already converted; this skill is a no-op).
  - If `"experiment_only"` → refuse (pure-validation projects have a different shape; this conversion doesn't apply).
- [ ] `_planning.md` must exist.

Refusal message names the current `project_kind` and tells the user what to do next.

## Actions

All 4 actions are idempotent — re-running the skill on a partially-converted project is safe (each action skips its own work if already done).

The implementation lives in `scripts/skills/add-experiment-phases-helper.ts`. The skill SHOULD invoke that helper rather than reimplementing the edits inline, so the unit tests at `scripts/skills/add-experiment-phases-helper.test.ts` cover the load-bearing logic.

### 1. Append `## Pre-Registered Analysis Plan` section to `_planning.md`

Insert the PRAP template fragment (exported from `scripts/skills/initialize-template-selector.ts` as `PRAP_SECTION_TEMPLATE`) between `## Options Considered` and `## Phased Execution Plan`. If the PRAP header is already present, skip.

Required content the user must fill in (enforced later by `/run_experiment_analysis` Step 1 via `prap-validator.ts`):
- Arms (control vs treatment); strategy IDs once known
- Sample size + justification
- Named statistical test (Mann-Whitney / McNemar / Bootstrap / Spearman / permutation)
- PASS / FAIL / INCONCLUSIVE thresholds (exact numbers)
- Per-arm balance metrics to check
- Judge-decisiveness threshold (default 0.6)
- Outlier rule
- Multi-criterion aggregation rule (when applicable per Decision #14)

### 2. Append experiment Phases 6-10 stub to `## Phased Execution Plan`

Insert the `EXPERIMENT_PHASES_STUB` template fragment. Anchor on the absence of `### Phase 6` header to detect already-applied state. The stub lists:
- Phase 6: Author or update the seed script
- Phase 7: `/manual_run_experiment`
- Phase 8: `/run_experiment_analysis`
- Phase 9: `/write_doc_for_completed_analysis` (transparent handoff)
- Phase 10: Follow-up PR (script + analysis report)

### 3. Union-merge evolution docs into `_status.json.relevantDocs`

Add these 5 docs if not already present (set-union; preserves existing entries):
- `evolution/docs/strategies_and_experiments.md`
- `evolution/docs/architecture.md`
- `evolution/docs/data_model.md`
- `evolution/docs/arena.md`
- `evolution/docs/rating_and_comparison.md`

### 4. Flip `_status.json.project_kind` from `"standard"` to `"feature_with_experiment"`

Atomic JSON read-modify-write. Preserves all other fields (`branch`, `created_at`, `prerequisites`, `experiment_id`, `analyses`).

## Implementation invocation

```bash
# Pure function — testable via scripts/skills/add-experiment-phases-helper.test.ts
PROJECT_PATH="docs/planning/$(resolve from arg or branch)"
PLAN_TEXT=$(cat "$PROJECT_PATH/${PROJECT_NAME}_planning.md")
STATUS_JSON=$(cat "$PROJECT_PATH/_status.json")

# planConversion returns {newPlanningDoc, newStatusJson, plan: {refusal, planningDocChanged, statusJsonChanged}}
RESULT=$(npx tsx -e "
  const helper = require('./scripts/skills/add-experiment-phases-helper');
  const status = JSON.parse(process.argv[1]);
  const plan = process.argv[2];
  console.log(JSON.stringify(helper.planConversion(plan, status)));
" "$STATUS_JSON" "$PLAN_TEXT")

REFUSAL=$(echo "$RESULT" | jq -r '.plan.refusal // empty')
if [ -n "$REFUSAL" ]; then
  echo "ERROR: $REFUSAL"
  exit 1
fi

# Write new files atomically
echo "$RESULT" | jq -r '.newPlanningDoc' > "$PROJECT_PATH/${PROJECT_NAME}_planning.md"
echo "$RESULT" | jq -r '.newStatusJson' > "$PROJECT_PATH/_status.json"
```

## Output

Print summary of writes made + suggested next step:

```
✓ Added ## Pre-Registered Analysis Plan section to _planning.md
✓ Appended Phases 6-10 stub to ## Phased Execution Plan
✓ Added 5 evolution docs to _status.json.relevantDocs
✓ Flipped project_kind: standard → feature_with_experiment

Next step: fill in the PRAP section in _planning.md (required by /run_experiment_analysis Step 1).
Suggested: /research to flesh out experiment design, then /plan-review to validate.
```

## Notes

- This skill is a one-way conversion (`standard` → `feature_with_experiment`). To go the other way, manually revert the 4 edits (or run `git revert` on the conversion commit).
- For projects that were created with `project_kind: "experiment_only"` (Pattern 2 — pure validation), this skill is N/A. Those projects already have the PRAP section by construction.
- The full design rationale is in `docs/planning/experiment_analysis_skill_20260628/` (Decisions #15-17 of the experiment-analysis project plan).
