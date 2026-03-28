# Maintenance Skills Research

## Problem Statement
We want to have skills that run processes periodically to help maintain the health of the project. Each skill should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback. These should run automatically in worktrees using tmux where possible.

## Requirements (from GH Issue #TBD)
- Overall instructions
    - Each of these should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback.
    - Prefer to do this automatically in a worktree using TMUX if possible, and alert user that these are being run
- Add a maintenance doc covering maintenance
- Specific skills
    - Refactor and simplify
        - Look at how to re-architect and simplify evolution codebase to make it easier to understand and maintain. Delete and confirmed dead code.
    - Test gap coverage
        - Look for gaps and issues with unit, integration, and e2e tests for evolution. Assess what runs on pushes to main vs. production
    - Update documentation
        - Look for gaps in documentation across both evolution docs and main docs directories and then make the necessary updates
    - Gaps in TS coverage
        - In evolution codebase, all key functions and DB reads/writes have inputs and outputs typed
    - Bug verification - reading code
        - Read through codebase to find bugs
    - Bugs and UX issue testing via manual verification
        - Use playwright to open evolution admin dashboard in stage and look for bugs as well as UX/usability issues

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/debugging_skill.md
- docs/docs_overall/instructions_for_updating.md
- evolution/docs/architecture.md

## Code Files Read
- [list of code files reviewed]
