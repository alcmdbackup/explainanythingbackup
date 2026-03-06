# More Efficient Full E2E Tests Prod Research

## Problem Statement
Split tests into evolution vs. non-evolution and run only the relevant portion based on what changed. Also detect and fix sources of flakiness in tests.

## Requirements (from GH Issue)
1. Split tests into evolution-focused vs. non-evolution, leveraging existing CI change-detection logic to run only relevant tests based on changed files
2. Enforce testing rules from `docs/docs_overall/testing_overview.md` to eliminate flakiness

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- [list of code files reviewed]
