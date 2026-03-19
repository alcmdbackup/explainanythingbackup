# Scan Evolution Stage Prod Issues Plan

## Background
Scan the evolution pipeline for discrepancies and bugs between staging and production environments, investigate failures, and fix identified issues.

## Requirements (from GH Issue #NNN)
Look for mismatches between tables in production and stage, and what the code is relying on for evolution. Use prod supabase query tool to query production. Otherwise, look for any/all types of bugs that could result from our recent migration to evolution V2.

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
- `docs/docs_overall/environments.md` - may need updates if env config differences are found
- `docs/docs_overall/debugging.md` - may need updates with new debugging findings
- `docs/docs_overall/testing_overview.md` - may need updates if test gaps are found
- `evolution/docs/evolution/reference.md` - may need updates if schema/config differences are found
- `evolution/docs/evolution/data_model.md` - may need updates if table mismatches are found
