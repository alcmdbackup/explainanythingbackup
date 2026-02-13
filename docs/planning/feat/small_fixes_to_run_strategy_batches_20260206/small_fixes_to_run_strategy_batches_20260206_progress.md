# Small Fixes to Run Strategy Batches Progress

## Phase 1: Fix Schema Mapping
### Work Done
- Fixed `scripts/run-batch.ts` to use correct column names:
  - `explanation_title` instead of `title`
  - `primary_topic_id` instead of `topic_id`
- Added auto-creation of "Batch Experiments" topic if it doesn't exist
- Removed invalid `user_id` field from insert

### Issues Encountered
- Initial batch run failed with: "Could not find the 'title' column of 'explanations' in the schema cache"
- Resolved by checking the actual explanations table schema in migrations

### User Clarifications
None required

## Phase 2: Add GPT-5.2 Models
### Work Done
- Added `gpt-5.2` and `gpt-5.2-pro` to `src/lib/schemas/schemas.ts` allowedLLMModelSchema
- Added pricing to `src/config/llmPricing.ts`:
  - gpt-5.2: $1.75 input / $14.00 output per 1M tokens
  - gpt-5.2-pro: $3.50 input / $28.00 output per 1M tokens

### Issues Encountered
None

### User Clarifications
- User requested GPT-5 family models (not just gpt-5-mini)
- Web search confirmed gpt-5.2 and gpt-5.2-pro are available

## Phase 3: Add Example Configs
### Work Done
- Created `experiments/` directory
- Added `experiments/fixed-cost-comparison.json` - Model/agent comparison config
- Added `experiments/strategy-comparison.json` - Basic strategy comparison config

### Issues Encountered
- Initial configs used too few iterations (1-4), but pipeline requires min 12
- Updated configs to use 12 iterations minimum

### User Clarifications
- User wanted fixed-cost comparisons (~$0.10 per run initially)
- Adjusted to realistic costs given pipeline minimum iteration requirements
