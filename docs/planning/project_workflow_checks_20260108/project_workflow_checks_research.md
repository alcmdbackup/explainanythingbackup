# Project Workflow Checks Research

## Problem Statement
Claude does not consistently follow project conventions before writing code. Previous implementation (reverted in commit `cd6145a`) attempted to enforce these conventions via hooks but was pulled back for further review.

## High Level Summary
Need enforcement mechanisms to ensure:
1. Required docs are read before any code editing
2. Todos are created for task planning
3. Quality checks pass before pushing to main

## Documents Read
- `/docs/docs_overall/getting_started.md`
- `/docs/docs_overall/project_workflow.md`
- Original planning doc at `/docs/planning/adhoc/project_workflow_checks.md`

## Code Files Read
- Previous implementation scripts (now reverted):
  - `.claude/hooks/start-dev-servers.sh`
  - `.claude/scripts/check-session-status.sh`
  - `.claude/scripts/check-workflow-ready.sh`
  - `.claude/scripts/pre-push-checklist.sh`
  - `.claude/scripts/track-prerequisites.sh`
  - `.claude/scripts/track-todos-created.sh`
  - `.claude/scripts/track-workflow-read.sh`
  - `.claude/settings.json`
