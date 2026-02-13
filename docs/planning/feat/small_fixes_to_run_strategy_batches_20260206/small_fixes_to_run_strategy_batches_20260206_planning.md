# Small Fixes to Run Strategy Batches Plan

## Background
The batch evolution run script was developed as part of the Elo budget optimization feature to enable systematic experimentation with different model/iteration configurations. However, when attempting to execute batch runs, the script fails due to schema mismatches with the explanations table.

## Problem
The `scripts/run-batch.ts` script uses incorrect column names when inserting explanations:
- Uses `title` instead of `explanation_title`
- Uses `topic_id: null` instead of `primary_topic_id` (which is NOT NULL)
- Missing topic creation logic for batch experiments

Additionally, GPT-5.2 models are not available for batch experiments because they're missing from the allowed models schema and pricing configuration.

## Options Considered
1. **Fix schema mapping only** - Just correct the column names
2. **Fix schema + auto-create topic** - Create a "Batch Experiments" topic automatically (chosen)
3. **Require existing topic ID** - Force users to specify a topic ID in batch config

Option 2 was chosen for the best user experience - batch runs should work out of the box.

## Phased Execution Plan

### Phase 1: Fix Schema Mapping (DONE)
- Update `run-batch.ts` to use `explanation_title` instead of `title`
- Update to use `primary_topic_id` instead of `topic_id`
- Add logic to get-or-create a "Batch Experiments" topic

### Phase 2: Add GPT-5.2 Models (DONE)
- Add `gpt-5.2` and `gpt-5.2-pro` to `allowedLLMModelSchema`
- Add pricing for these models to `LLM_PRICING`

### Phase 3: Add Example Configs (DONE)
- Create `experiments/` directory
- Add example batch configuration files

## Testing
- Manual testing: Run batch with `--dry-run` to verify config parsing
- Manual testing: Run batch with `--confirm` to verify actual execution
- Existing unit tests for `batchRunSchema.ts` should continue to pass

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/elo_budget_optimization.md` - May need to document GPT-5.2 support
