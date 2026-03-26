# Workflow Changes Plan

## Background
Improve the project workflow by (1) letting users manually tag docs during /initialize before auto-discovery runs, and (2) adding a new /summarize-plan command that concisely summarizes a project's plan, changed files, and tracked docs.

**Note on naming:** The command file is `summarize-plan.md` and the slash command is `/summarize-plan` (hyphen). The user's original requirement used underscore (`/summarize_plan`), but Claude Code derives slash command names from the filename, so hyphens are correct.

## Requirements (from GH Issue #789)
- In /initialize, let user manually tag docs as a first step, before suggesting docs. Free text entry, user can @docs to identify them. Find these and add them to list of tracked docs.
- new /summarize_plan command
    - Summarize plan file in directory - be as concise as possible
    - 5 bullet points overview of plan
    - More detail overview of changes below
    - Show all files are modified/deleted
    - Show what key docs are being tracked

## Problem
Currently /initialize only offers auto-discovered docs for tracking — users who already know which docs are relevant have no way to specify them upfront. The auto-discovery agent sometimes misses relevant docs or suggests irrelevant ones. Additionally, there's no quick way to get a summary of a project's plan without reading the entire planning document. A /summarize_plan command would give a fast overview useful for context-switching or sharing with others.

## Options Considered

### Option A: Manual tagging as separate step before auto-discovery (Chosen)
- Insert new step 2.6 in initialize.md
- Ask user for docs via AskUserQuestion with free text ("Other")
- Fuzzy-match typed names against known doc files
- Merge into RELEVANT_DOCS, then auto-discovery supplements
- **Pros**: Clean separation, user input comes first, auto-discovery fills gaps
- **Cons**: Extra prompt step even when user has no docs to add

### Option B: Merge manual tagging into existing step 2.7
- Modify the multiSelect in step 2.7 to allow free text additions alongside auto-discovered suggestions
- **Pros**: Fewer prompts
- **Cons**: Harder to implement — AskUserQuestion multiSelect doesn't natively support mixing predefined + free text

### Option C: Skip manual tagging, improve auto-discovery only
- **Rejected**: Doesn't meet the requirement for user-driven doc tagging

**Decision**: Option A — cleanest implementation, respects user intent first.

## Phased Execution Plan

### Phase 1: Add Manual Doc Tagging to /initialize

**Goal**: Insert step 2.6 into `.claude/commands/initialize.md` that lets users manually specify docs before auto-discovery.

**Files modified:**
- `.claude/commands/initialize.md` — Add new step 2.6 between existing steps 2.5 and 2.7

**Implementation:**

Insert new step 2.6 after step 2.5 (Read Core Documentation) and before step 2.7 (Discover Relevant Project Documentation):

```markdown
### 2.6. Manual Doc Tagging (Optional)

Before auto-discovery, give the user a chance to manually specify docs they already know are relevant.

1. **Ask user** via AskUserQuestion:
   - Question: "Do you want to manually tag any docs to track for this project? You can type doc names or paths (e.g. 'tag_system', 'docs/feature_deep_dives/error_handling.md'). Select 'Skip' to go straight to auto-discovery."
   - Options:
     1. "Yes, I'll specify docs" — user selects "Other" and types doc names/paths
     2. "Skip to auto-discovery" — continue to step 2.7

2. **If user provides doc names/paths:**
   - Parse the user's input: split on commas first, then trim whitespace from each entry. If no commas, split on newlines. Entries with spaces are treated as a single doc name (e.g., "error handling" matches "error_handling.md").
   - For each entry, fuzzy-match against all markdown files in:
     - `docs/docs_overall/`
     - `docs/feature_deep_dives/`
     - `evolution/docs/evolution/`
   - Use Glob tool (not `ls`) to find matches. Two calls needed since evolution/ is a sibling to docs/:
     - `Glob("**/*{user_input}*.md", path="docs/")` — covers docs_overall/ and feature_deep_dives/
     - `Glob("**/*{user_input}*.md", path="evolution/docs/evolution/")` — covers evolution docs
   - Matching logic:
     - If entry is a full path and file exists → use directly
     - If entry is a partial name → find files containing that string (case-insensitive)
     - If multiple matches → present matches via AskUserQuestion and let user pick
     - If no match → warn user: "No doc found matching '[entry]'. Skipping." and continue
     - If user provides empty input after selecting "Yes" → treat as skip, continue to step 2.7
   - Add all resolved paths to `RELEVANT_DOCS`
   - **Read all manually tagged docs** using the Read tool

3. **Continue to step 2.7** — auto-discovery will supplement (not replace) manually tagged docs. The Explore agent prompt should note: "Exclude any docs already in RELEVANT_DOCS from suggestions."

**Note on evolution docs:** Step 2.6 searches `evolution/docs/evolution/` in addition to the two directories that step 2.7 auto-discovery covers. This is intentional — manual tagging allows broader scope. Step 2.7's Explore agent scope remains unchanged (docs/docs_overall/ and docs/feature_deep_dives/ only).

**Note on relevantDocs constraint:** The existing step 3.5 says relevantDocs "must only contain paths under docs/docs_overall/ or docs/feature_deep_dives/". This constraint must be relaxed to also allow `evolution/docs/evolution/` paths, since users may manually tag evolution docs. Update the step 3.5 comment to: "relevantDocs may contain paths under docs/docs_overall/, docs/feature_deep_dives/, or evolution/docs/evolution/."

**Note on RELEVANT_DOCS flow:** Step 3.5 populates `_status.json` relevantDocs from the merged RELEVANT_DOCS list (manual from step 2.6 + auto-discovered from step 2.7). Both sources contribute to the same array.
```

Also update step 2.7's Explore agent prompt to exclude already-tagged docs:

```
Rules:
- Only include files from docs/docs_overall/ and docs/feature_deep_dives/
- Do NOT include any files from docs/planning/
- Exclude the 3 core docs already read: getting_started.md, architecture.md, project_workflow.md
- Exclude docs already manually tagged by user: [list RELEVANT_DOCS entries]
```

And update the step 2.7 AskUserQuestion text to note which docs were manually tagged:

```
"Auto-discovery found these additional docs (you already tagged: [list]). Select any to add:"
```

Also update step 9 (Output Summary) to include manually tagged docs count:
```
Manually tagged docs: [count from step 2.6]
   - [list manually tagged paths]
Relevant docs discovered and read: [count from step 2.7]
   - [list each path from RELEVANT_DOCS]
```

**Quality gate**: Read modified initialize.md, verify step numbering is consistent (2.5 → 2.6 → 2.7 — no renumbering needed), no duplicate steps.

### Phase 2: Create /summarize-plan Command

**Goal**: Create new `.claude/commands/summarize-plan.md` command.

**Files created:**
- `.claude/commands/summarize-plan.md`

**Implementation:**

```markdown
---
description: Summarize a project's plan file concisely — overview bullets, detailed changes, modified files, and tracked docs
argument-hint: [project-name]
allowed-tools: Bash(git:*), Read, Glob, Grep, AskUserQuestion
---

# /summarize-plan - Plan Summary

Generate a concise summary of a project's planning document.

## Usage

\`\`\`
/summarize-plan [project-name]
\`\`\`

- `project-name` (optional): Project name or partial match. If omitted, detect from `_status.json` branch mapping.

## Execution Steps

### 1. Find Project Folder

If argument provided, use Glob to search for matching folder:
\`\`\`
Glob("docs/planning/*${PROJECT_NAME}*")
\`\`\`

If no argument, find the active project by matching the current branch against `_status.json` files:
\`\`\`bash
BRANCH=$(git branch --show-current)
# Search all _status.json files for the one whose "branch" field matches
grep -Frl "\"branch\": \"${BRANCH}\"" docs/planning/*/_status.json
\`\`\`

This returns the path to the matching `_status.json` (e.g., `docs/planning/workflow_changes_20260323/_status.json`), from which the project folder is derived by stripping the filename.

**Why this approach:** Every project created by `/initialize` writes the branch name into `_status.json`. Matching against this is more robust than parsing branch names — no sed, no slash handling, no fallbacks needed.

Validation:
- If no matching `_status.json` found, abort with: "Error: No project found for branch '$BRANCH'. Provide a project name or ensure /initialize was run."
- If multiple matches found, list them and use AskUserQuestion to let user pick one.

### 2. Read Project Files

Read these files from the project folder:
1. `*_planning.md` or `_planning.md` — the plan content (REQUIRED — abort if missing: "Error: No planning file found in [folder].")
2. `_status.json` — for `relevantDocs` array (if missing or no `relevantDocs` key, show "No tracked docs" in output)
3. `*_research.md` or `_research.md` — for requirements context (optional, skip if missing)

### 3. Get Changed Files

\`\`\`bash
# Fetch to ensure origin/main is current
git fetch origin main 2>/dev/null || true

# Committed changes vs origin/main
git diff --name-only origin/main...HEAD
\`\`\`

Also check for uncommitted changes:
\`\`\`bash
git diff --name-only HEAD
git ls-files --others --exclude-standard
\`\`\`

Categorize files as: modified, added, deleted, or uncommitted.

### 4. Generate Summary

Output this exact format:

\`\`\`
# Plan Summary: [Project Name]

## Overview (5 bullets max)
- [bullet 1 — most important aspect of the plan]
- [bullet 2]
- [bullet 3]
- [bullet 4]
- [bullet 5]

## Detailed Changes
[More detailed description of what the plan entails, organized by phase if the plan has phases. Be concise but thorough.]

## Files Changed (vs origin/main)
### Modified
- path/to/file.ts

### Added
- path/to/new-file.ts

### Deleted
- path/to/removed-file.ts

### Uncommitted
- path/to/wip-file.ts (if any)

## Tracked Docs
[List from _status.json relevantDocs array, or "No tracked docs" if missing]
- docs/feature_deep_dives/tag_system.md
- docs/docs_overall/architecture.md
\`\`\`

### 5. Conciseness Rules

- Overview bullets: max 15 words each
- Detailed changes: max 200 words total
- File lists: just paths, no descriptions
- Tracked docs: just paths, no descriptions
- No filler text, headers, or explanations beyond the template
```

**Quality gate**: Verify the new command file has valid frontmatter, consistent with other commands (matches finalize.md pattern).

### Phase 3: Update Documentation

**Files modified:**
- `docs/docs_overall/project_workflow.md` — mention /summarize-plan in the workflow steps

**Implementation:**
- In `project_workflow.md`, add a note after the "Step 5: Complete Plan" section (line ~68), before "Step 6: Execute":

```markdown
> **Tip:** Use `/summarize-plan` at any point to get a quick overview of your plan, changed files, and tracked docs.
```

- Also add `/summarize-plan` to the "Document Templates" section or a new "Useful Commands" section at the bottom if one doesn't exist.

**Quality gate**: Read project_workflow.md, verify the addition fits naturally and doesn't disrupt existing numbering.

## Testing

### Manual Testing — /initialize Changes
- Run `/initialize` on a test project — verify step 2.6 manual doc tagging appears before auto-discovery
- Type doc names in various formats (full path, partial name, multiple comma-separated entries) and verify fuzzy matching
- Type a non-existent doc name → verify warning "No doc found matching..." and graceful skip
- Select "Yes, I'll specify docs" but provide empty input → verify treated as skip
- Type a partial name that matches multiple docs → verify disambiguation prompt
- Skip manual tagging → verify auto-discovery still works unchanged
- Manually tag a doc, then verify auto-discovery excludes it from suggestions
- Verify step 9 output includes manually tagged doc count

### Regression Testing — /initialize
- Run `/initialize` end-to-end selecting "Skip to auto-discovery" at step 2.6 → verify all subsequent steps (2.7, 3, 3.5, 3.8, 4, 5, 6, 6.5, 7, 8, 9) produce identical output to pre-change behavior
- Verify `_status.json` relevantDocs contains exactly the auto-discovered docs (since manual tagging was skipped in this test case)
- Verify `_planning.md` and `_research.md` are created with correct templates
- Verify step 9 output shows "Manually tagged docs: 0" or omits that line when none tagged
- Verify cross-step variable passing: `RELEVANT_DOCS` from step 2.7 flows correctly to steps 3.5, 4, and 5

### Manual Testing — /summarize-plan
- Run `/summarize-plan` on an existing project with a populated planning doc
- Run `/summarize-plan` with no argument from a project branch → verify branch detection
- Run `/summarize-plan` with explicit project name argument
- Run on project with no `_status.json` or empty `relevantDocs` → verify "No tracked docs"
- Run on project folder with no `_planning.md` → verify error message
- Run with ambiguous project name matching multiple folders → verify disambiguation
- Run with whitespace-only argument → verify falls back to _status.json lookup
- Run from branch with no matching _status.json → verify clear error message
- Verify output format matches the template exactly

### Cross-Command Integration
- Run `/initialize` → then immediately run `/summarize-plan` on same project → verify it finds planning file and shows tracked docs

### Rollback Plan
- All three phases will be committed together — a single `git revert` rolls back everything
- Includes: initialize.md changes, summarize-plan.md creation, project_workflow.md update
- No production code or CI/CD pipelines affected
- If step 2.6 breaks /initialize flow, can be removed without affecting steps 2.5 or 2.7 (no renumbering needed)

### No Unit Tests Needed
- These are markdown skill files, not TypeScript code — no unit tests apply
- Testing is manual verification of the command behavior

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/project_workflow.md` — Add mention of /summarize-plan command
