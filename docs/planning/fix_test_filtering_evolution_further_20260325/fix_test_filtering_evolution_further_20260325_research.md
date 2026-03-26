# Fix Test Filtering Evolution Further Research

## Problem Statement
The evolution runs and invocations list pages have a "Hide test content" checkbox that starts checked, but the initial data load doesn't actually apply the filter. Test runs appear on first load. Toggling the checkbox off then on again makes the filter work correctly. Additionally, the evolution dashboard overview page was missing the test content filter entirely. This project fixes the initial load filtering, adds the missing dashboard filter, and adds regression tests.

## Requirements (from GH Issue #TBD)
1. Fix: evolution dashboard overview page missing test content filter entirely (already done)
2. Fix: runs list page initial load ignores filterTestContent despite checkbox being checked
3. Fix: invocations list page initial load ignores filterTestContent despite checkbox being checked
4. Audit: check all other evolution list pages for the same initial-load bug
5. Add regression tests for each fix to prevent future breakage

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- evolution/docs/architecture.md

## Code Files Read
- [list of code files reviewed]
