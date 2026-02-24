# Implement Safe Read-Only Access to Prod Supabase Research

## Problem Statement
We need a safe way to query the production Supabase database for debugging, analytics, and data inspection. The solution must not grant write access and must not expose the production Supabase service role key or anon key in local environments or code.

## Requirements (from GH Issue #NNN)
- A) No write access — queries must be strictly read-only
- B) No exposure of prod Supabase keys — the prod service role key and anon key must not appear in .env files, code, or logs

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md

## Code Files Read
- [list of code files reviewed]
