# Add Model Support GPT-OSS-20B Research

## Problem Statement
Add GPT-OSS-20B as a new LLM provider. This involves adding the model to the allowed models schema, configuring a new API client, adding pricing data, and updating environment configuration for the new provider's API key.

## Requirements (from GH Issue #TBD)
- Add support for the new GPT-OSS-20B model from OpenAI
- Make it available from model selection dropdown for strategy creation
- Have correct costs for it for budgeting purposes

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/ai_suggestions_overview.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/server_action_patterns.md

### Code Files Read
- src/lib/services/llms.ts
- src/config/llmPricing.ts
- src/lib/schemas/schemas.ts (allowedLLMModelSchema)
