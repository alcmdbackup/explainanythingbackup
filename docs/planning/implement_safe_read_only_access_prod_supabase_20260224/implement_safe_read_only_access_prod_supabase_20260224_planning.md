# Implement Safe Read-Only Access to Prod Supabase Plan

## Background
We need a safe way to query the production Supabase database for debugging, analytics, and data inspection. The solution must not grant write access and must not expose the production Supabase service role key or anon key in local environments or code.

## Requirements (from GH Issue #NNN)
- A) No write access — queries must be strictly read-only
- B) No exposure of prod Supabase keys — the prod service role key and anon key must not appear in .env files, code, or logs

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
- `docs/docs_overall/environments.md` - May need new section on read-only prod access
- `docs/docs_overall/testing_overview.md` - May need notes on prod data inspection patterns
