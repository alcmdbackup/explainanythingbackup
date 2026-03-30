# Find Fix Flaky Tests Research

## Problem Statement
Main branch has gotten into a broken state where not all tests pass. A force merge was required to get code into main without all tests passing. This project will run the full local test suite (lint, typecheck, build, unit, ESM, integration, E2E critical) equivalent to /finalize checks, identify all failures, and fix them to restore CI health and developer confidence.

## Requirements (from GH Issue #TBD)
- Run the entire test suite that would run on merging into main locally (equivalent to /finalize)
- Fix everything that fails
- Main has somehow gotten into a broken state and had to force merge without all tests passing

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
- docs/docs_overall/environments.md
- evolution/docs/architecture.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/debugging_skill.md

## Code Files Read
- [list of code files reviewed]
