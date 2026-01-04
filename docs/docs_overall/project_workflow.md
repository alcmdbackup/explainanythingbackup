# Project Workflow

Complete workflow for starting, planning, executing, and wrapping up projects.

## Starting a New Project

Before starting any new project, ensure the following requirements are met:

1. **Project path required** - Reject any attempt to start without a path in format `/docs/planning/project_name_date` (e.g., `/docs/planning/fix_bug_20251225`). Ask for clarification if path is not clear.
2. **Folder setup** - Create a new folder at this path if needed
3. **Doc setup** - Create documents within this folder following the templates below:
   - `_research.md` (e.g., `fix_bug_research.md`)
   - `_planning.md` (e.g., `fix_bug_planning.md`)
   - `_progress.md` (e.g., `fix_bug_progress.md`)
4. **Create a GitHub issue** - Include a 3-5 sentence summary of the work needed
5. **Provide URL** - Share the link to the relevant project folder

Always use the planning doc for updates, rather than internal Claude planning files.

---

## Execution Steps

### Step 1: Research
- Look at the codebase and populate the research doc
- Keep iterating on research until results are thorough enough to start planning
- Use different agents to form different perspectives if needed, then reconcile results
- Multiple rounds are OK

### Step 2: Plan
- Update the plan doc based on the template provided
- The plan must be incrementally executable and testable
- Create and update any tests and documentation as needed

### Step 3: Plan Review
- Use `/plan-review <path-to-plan>` to run the iterative multi-agent review loop
- This launches 3 parallel agents (Security, Architecture, Testing) that score the plan 1-5
- The loop continues until all agents vote 5/5 or max iterations reached
- See [Iterative Planning Agent](../feature_deep_dives/iterative_planning_agent.md) for details

### Step 4: Complete Plan
- Ensure all sections in plan template are completed
- Final criteria:
  - Plan conveys high-level structure
  - Plan is organized into phases that can be implemented and tested incrementally
  - Plan contains key snippets of code
  - Plan lists all code modified
  - Plan lists all tests added or modified (unit/integration/E2E)

### Step 5: Execute
- Execute the plan incrementally in phases
- Update the progress doc along the way
- Commit once each phase is done

### Step 6: Wrap Up
- Run build, tsc, lint, unit, integration, and E2E tests
- Fix all issues regardless of whether they originated with this project
- Update all relevant documentation

### Step 7: Push to main
- Push to remote, then create a PR to pull into main branch (which is really staging)
- Do not worry about production, that will be taken care of later

---

## Document Templates

### Research Document
```markdown
# [Project Name] Research

## Problem Statement
[Description of the problem]

## High Level Summary
[Summary of findings]

## Documents Read
- [list of docs reviewed]

## Code Files Read
- [list of code files reviewed]
```

### Planning Document
```markdown
# [Project Name] Plan

## Background
[3-5 sentences of context]

## Problem
[3-5 sentences describing the problem]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
[Files in docs/docs_overall and docs/feature_deep_dives to update]
```

### Progress Document
```markdown
# [Project Name] Progress

## Phase 1: [Phase Name]
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

### User Clarifications
[Questions asked and answers received]

## Phase 2: [Phase Name]
...
```

---

## Plan Evaluation Guidelines

When evaluating a plan, consider:
- Use the internet to review any necessary documentation
- Reference [architecture.md](architecture.md) and [feature_deep_dives/](../feature_deep_dives/) for current state
- Check `/docs/planning` for relevant historical files (note: these are archives and may not be actively maintained)
