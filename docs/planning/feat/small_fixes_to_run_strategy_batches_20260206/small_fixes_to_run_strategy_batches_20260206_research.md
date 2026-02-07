# Small Fixes to Run Strategy Batches Research

## Problem Statement
The batch evolution run script (`scripts/run-batch.ts`) has schema mismatches that prevent it from creating explanations for batch runs. Additionally, the GPT-5.2 family models need to be added to the allowed models and pricing configuration.

## High Level Summary
Two issues were identified and fixed:
1. Schema mismatch in `run-batch.ts` - using `title` instead of `explanation_title`, and `topic_id` instead of `primary_topic_id`
2. Missing GPT-5.2 models in `allowedLLMModelSchema` and `LLM_PRICING`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (None selected)

## Code Files Read
- scripts/run-batch.ts - Batch evolution runner CLI
- src/config/llmPricing.ts - LLM pricing configuration
- src/lib/schemas/schemas.ts - Allowed LLM models schema
- src/lib/evolution/config.ts - Evolution pipeline configuration
