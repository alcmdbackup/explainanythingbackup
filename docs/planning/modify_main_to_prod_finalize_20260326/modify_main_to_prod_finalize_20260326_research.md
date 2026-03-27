# Modify Main To Prod Finalize Research

## Problem Statement
Modify mainToProd and finalize skills.

## Requirements (from GH Issue #NNN)
- Avoid failfast, see all things that fail and then try to fix all at once, rather than 1 by 1
- Always run integration/E2E tests locally if possible before pushing
- On any failure, fix failing tests locally, verify they pass locally
- Then proceed to create PR and do CI
- On any failure, fix failing tests locally, verify they pass locally, then resubmit to run FULL CI on GH. Never re-run only failing tests on GH.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- .claude/commands/mainToProd.md
- .claude/commands/finalize.md

## Code Files Read
- [list of code files reviewed]
