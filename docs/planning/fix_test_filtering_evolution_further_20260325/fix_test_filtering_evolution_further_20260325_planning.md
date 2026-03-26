# Fix Test Filtering Evolution Further Plan

## Background
The evolution runs and invocations list pages have a "Hide test content" checkbox that starts checked, but the initial data load doesn't actually apply the filter. Test runs appear on first load. Toggling the checkbox off then on again makes the filter work correctly. Additionally, the evolution dashboard overview page was missing the test content filter entirely. This project fixes the initial load filtering, adds the missing dashboard filter, and adds regression tests.

## Requirements (from GH Issue #TBD)
1. Fix: evolution dashboard overview page missing test content filter entirely (already done)
2. Fix: runs list page initial load ignores filterTestContent despite checkbox being checked
3. Fix: invocations list page initial load ignores filterTestContent despite checkbox being checked
4. Audit: check all other evolution list pages for the same initial-load bug
5. Add regression tests for each fix to prevent future breakage

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
- `docs/docs_overall/testing_overview.md` - may need updates to test data filtering docs
- `evolution/docs/architecture.md` - may need updates to dashboard/admin UI docs
