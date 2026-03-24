# Workflow Changes Research

## Problem Statement
Workflow improvements — General improvements to the project workflow system.

## Requirements (from GH Issue #789)
- In /initialize, let user manually tag docs as a first step, before suggesting docs. Free text entry, user can @docs to identify them. Find these and add them to list of tracked docs.
- new /summarize_plan command
    - Summarize plan file in directory - be as concise as possible
    - 5 bullet points overview of plan
    - More detail overview of changes below
    - Show all files are modified/deleted
    - Show what key docs are being tracked

## High Level Summary

Two changes needed:
1. **Modify `/initialize`** (`.claude/commands/initialize.md`) — Add a new step before step 2.7 where user can manually specify docs to track via free text. These get merged into `RELEVANT_DOCS` before the auto-discovery step.
2. **Create `/summarize_plan`** — New command (`.claude/commands/summarize-plan.md`) that reads a project's `_planning.md`, shows a concise summary, lists modified/deleted files, and shows tracked docs from `_status.json`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/project_workflow.md

## Code Files Read
- `.claude/commands/initialize.md` — Full /initialize skill definition, 9 steps with doc discovery at step 2.7
- `.claude/commands/finalize.md` — Uses relevantDocs + doc-mapping.json to identify docs needing updates
- `.claude/commands/research.md` — /research command structure
- `.claude/doc-mapping.json` — 72 glob→doc mappings, `alwaysConsider` array
- Multiple `docs/planning/*/_status.json` — relevantDocs array structure

## Key Findings

### Finding 1: Skill System Structure
- **Commands** live in `.claude/commands/*.md` with YAML frontmatter (description, argument-hint, allowed-tools)
- **Skills** live in `.claude/skills/*/SKILL.md` with similar frontmatter
- 7 commands exist: initialize, research, plan-review, finalize, mainToProd, debug, user-test
- 5 skills exist: plan-review, plan-review-loop, debug, git-github, add-to-sandbox-whitelist

### Finding 2: /initialize Doc Discovery (Current Step 2.7)
- Spawns Explore agent to search `docs/docs_overall/` and `docs/feature_deep_dives/`
- Agent reads first 30 lines per file, returns ranked list of up to 10
- Results presented via AskUserQuestion (multiSelect)
- Confirmed list stored as `RELEVANT_DOCS` → written to `_status.json`
- **No manual tagging step exists** — user can only select from auto-discovered suggestions

### Finding 3: Available Docs (48 total)
- `docs/docs_overall/` — 11 files (architecture, testing, debugging, etc.)
- `docs/feature_deep_dives/` — 24 files (tag_system, editor, sources, etc.)
- `evolution/docs/evolution/` — 13 files (arena, data_model, architecture, etc.)
- No master index/catalog exists

### Finding 4: AskUserQuestion Constraints
- Requires 2-4 predefined options (min 2)
- Users can always select "Other" for free text entry
- multiSelect allows picking multiple items
- Free text workaround: put prompt in question, user responds via "Other" with typed text

### Finding 5: _status.json relevantDocs Pattern
```json
{
  "branch": "feat/project_name",
  "created_at": "ISO timestamp",
  "prerequisites": {},
  "relevantDocs": ["docs/feature_deep_dives/tag_system.md", ...]
}
```
- Paths are repo-relative
- Used by /finalize to check which docs need updates
- Separate from doc-mapping.json (which is pattern-based automation)

### Finding 6: /finalize Doc Update Flow
1. Gets changed files via `git diff --name-only origin/main`
2. Loads doc-mapping.json, matches changed files to docs
3. AI analysis for unmapped files
4. Evaluates `alwaysConsider` docs
5. Generates and applies updates
6. Blocks PR if doc-worthy changes exist but updates fail

## Design Decisions for Implementation

### Requirement 1: Manual Doc Tagging in /initialize
- **Insert new step 2.6** before existing step 2.7 (auto-discovery)
- Ask user: "Would you like to manually tag any docs to track? Type doc names/paths, or skip."
- Use AskUserQuestion with options like "Yes, I'll specify docs" / "Skip to auto-discovery"
- If user types docs, fuzzy-match against the 48 known doc files
- Merge manually tagged docs into `RELEVANT_DOCS` before step 2.7
- Step 2.7 auto-discovery then supplements (not replaces) the manual list

### Requirement 2: /summarize_plan Command
- Create `.claude/commands/summarize-plan.md`
- Steps:
  1. Find project folder (from branch name or argument)
  2. Read `_planning.md`
  3. Read `_status.json` for relevantDocs
  4. Run `git diff --name-only origin/main` for modified/deleted files
  5. Output:
     - 5 bullet points: high-level plan overview
     - Detailed changes section
     - Files modified/deleted list
     - Tracked docs list from relevantDocs

## Open Questions
- None — requirements are clear and implementation path is straightforward.
