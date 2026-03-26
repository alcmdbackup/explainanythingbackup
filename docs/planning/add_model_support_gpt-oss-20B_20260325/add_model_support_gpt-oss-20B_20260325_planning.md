# Add Model Support GPT-OSS-20B Plan

## Background
Add GPT-OSS-20B as a new LLM provider. This involves adding the model to the allowed models schema, configuring a new API client, adding pricing data, and updating environment configuration for the new provider's API key.

## Requirements (from GH Issue #TBD)
- Add support for the new GPT-OSS-20B model from OpenAI
- Make it available from model selection dropdown for strategy creation
- Have correct costs for it for budgeting purposes

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/llm_provider_limits.md` - Add GPT-OSS-20B provider entry and spending limits
- `docs/feature_deep_dives/search_generation_pipeline.md` - May need update if model is used in generation
- `docs/feature_deep_dives/ai_suggestions_overview.md` - May need update if model is used for suggestions
- `docs/docs_overall/environments.md` - Add new env var for GPT-OSS-20B API key
- `docs/feature_deep_dives/server_action_patterns.md` - Likely no changes needed
