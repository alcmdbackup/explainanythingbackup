# Remove Firefox Stage Merges Research

## Problem Statement
Stop requiring Firefox on stage merges. The PR-CI pipeline for stage (PRs to `main`) currently runs a Firefox browser matrix on the `e2e-evolution` job whenever evolution/admin paths change, which slows down stage merges and forces fixes for Firefox-only flakiness before merge. Firefox coverage will remain in the nightly E2E suite, not blocking PR merges.

## Requirements (from GH Issue #NNN)
stop requiring firefox on stage merges

## High Level Summary
[To be populated during /research]

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (discovered in step 2.7)
- (none — user requested standard docs only)

## Code Files Read
- [to be populated during /research]
