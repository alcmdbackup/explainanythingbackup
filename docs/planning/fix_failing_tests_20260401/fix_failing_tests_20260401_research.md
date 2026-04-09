# Fix Failing Tests Research

## Problem Statement
Fix integration and E2E test failures identified in PR #920 CI runs. The PR made significant changes across 60 files including lint violation fixes, serial mode additions, TypeScript schema fixes, and evolution pipeline bug fixes.

## Requirements (from GH Issue)
Run failing tests from PR #920 locally, identify root causes, fix issues, verify all tests pass

## High Level Summary
PR #920 introduced changes to enforce testing best practices (serial mode, point-in-time checks, typed createClient). Late commits suggest CI failures related to FK constraints in E2E evolution test seeding and strategy insert error handling.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/error_handling.md

### Evolution Docs
- All 16 evolution docs in evolution/docs/

## Code Files Read
- PR #920 diff (60 files changed, 2045 insertions, 185 deletions)
- Key commits: a46fab1 (FK constraint fix), 51c23ac (error handling for strategy inserts)
