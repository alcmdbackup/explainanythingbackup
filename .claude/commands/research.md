# /research - Project Research Phase

Conduct research for a specific project following Step 1: Research from project_workflow.md.

## Usage

```
/research <project-name>
```

- `project-name` (required): Project name or partial match (e.g., "clean_up_production_articles_investigation")

## Execution Steps

When invoked, you MUST follow this exact process:

### 1. Parse and Validate Input

```bash
PROJECT_NAME="$ARGUMENTS"
```

**Validation:**
- If `$ARGUMENTS` is empty, abort with: "Error: Project name required. Usage: /research <project-name>"

### 2. Find Project Folder

Search for the project folder in `docs/planning/`:

```bash
# Find folders matching the project name
ls -d docs/planning/*${PROJECT_NAME}* 2>/dev/null | head -1
```

**Validation:**
- If no matching folder found, abort with: "Error: No project folder found matching '$PROJECT_NAME'. Run /initialize first."
- If multiple matches, list them and ask user to be more specific

### 3. Read Project Context

Read ALL files in the project folder to understand the research scope:

1. **Read the research document** (`*_research.md` or `_research.md`) - see what's already been researched
2. **Read the planning document** (`*_planning.md` or `_planning.md`) - understand the problem and goals
3. **Read the progress document** (`*_progress.md` or `_progress.md`) - check current status

Extract from these files:
- The problem statement / goal
- What has already been researched
- What gaps remain
- Any specific areas mentioned that need investigation

### 4. Read Current Research Guidelines

**Read `docs/docs_overall/project_workflow.md`** and extract the "Step 1: Research" section. Follow those instructions exactly - they are the source of truth and may be updated.

### 5. Conduct Research

Based on the project context and guidelines from project_workflow.md:

1. **Explore the codebase** - Use Task agents with subagent_type=Explore to investigate relevant areas
2. **Read documentation** - Check `docs/docs_overall/` and `docs/feature_deep_dives/` for context
3. **Examine code files** - Read relevant source files to understand current implementation
4. **Form multiple perspectives** - Use different exploration strategies if the problem is complex
5. **Iterate as needed** - Multiple research rounds are expected and encouraged

### 6. Update Research Document

Populate the research document with findings:

```markdown
## Problem Statement
[Clear description of what we're investigating - from project files]

## High Level Summary
[Key findings and insights]

## Documents Read
- docs/docs_overall/architecture.md - [key insight]
- [other docs with insights]

## Code Files Read
- src/path/to/file.ts - [what we learned]
- [other files with insights]

## Key Findings
[Numbered list of important discoveries]

## Open Questions
[Questions that need answers before planning]
```

### 7. Assess Completeness

Before finishing, verify:
- [ ] Problem is clearly understood
- [ ] Relevant code areas have been identified
- [ ] Current implementation approach is documented
- [ ] Gaps or issues are catalogued
- [ ] Enough context exists to begin brainstorming solutions

If research is incomplete, continue iterating. Use `AskUserQuestion` if clarification is needed from the user.

### 8. Output Summary

Display completion message:

```
Research phase complete!

Project: [project folder path]
Research doc: [path to research doc]

Key findings:
- [bullet summary of main discoveries]

Ready for: /plan-review or continue to brainstorming in _planning.md
```

## Research Strategies

Depending on the problem type, use appropriate strategies:

| Problem Type | Strategy |
|--------------|----------|
| Bug fix | Trace error flow, find reproduction path, identify root cause |
| New feature | Map related features, understand patterns, identify integration points |
| Refactor | Document current state, identify coupling, map dependencies |
| Performance | Profile hotspots, trace data flow, identify bottlenecks |
| Data cleanup | Identify data sources, trace data flow, map all surfaces where data appears |

## Notes

- The research guidelines in `project_workflow.md` are authoritative - always read them fresh
- Use Task agents with subagent_type=Explore for broad codebase exploration
- Document everything - even "obvious" findings help during planning
- It's OK to run /research multiple times as understanding deepens
- The project files tell you WHAT to research - use them as your guide
