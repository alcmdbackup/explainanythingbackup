# Finalize Should Update Docs Research

**Date**: 2026-01-11
**Researcher**: Claude
**Git Commit**: 4669b11be0d73df605684fc3300c591d43f48ae2
**Branch**: fix/finalize_should_update_docs
**Repository**: Minddojo/explainanything

## Research Questions
1. What is the best way to enforce that docs are updated?
2. How should we decide if a given doc needs to be updated at all?
3. How does the current /finalize skill work and where is it defined?
4. What patterns exist for detecting which docs need updating based on changed files?
5. How do other skills handle documentation-related tasks?
6. Are there any skills available today for updating docs?

---

## High Level Summary

The `/finalize` command (located at `.claude/commands/finalize.md`) handles rebasing, running checks, and creating PRs but **does not include documentation updates**. The codebase has no automated system to detect which docs need updating based on changed files. Documentation updates rely on **manual enforcement** through:
1. Planning templates that require listing docs to update
2. Guidelines in `instructions_for_updating.md`
3. The project workflow's Step 7 (Wrap Up) that says "Update all relevant documentation"

However, none of these are enforced by hooks or CI - they are advisory only.

---

## Detailed Findings

### 1. /finalize Command Structure

**Location**: `.claude/commands/finalize.md`

**Current workflow (5 steps)**:
1. Fetch and Rebase
2. Run Checks (lint, tsc, build, unit, integration)
3. E2E Tests (optional with `--e2e` flag)
4. Commit Changes (if any fixes made)
5. Push and Create PR

**What's missing**: No step for documentation review or updates.

**Allowed tools**: `Bash(git:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(gh:*)`, `Read`, `Edit`, `Write`, `Grep`, `Glob`

---

### 2. Documentation Structure

**27 docs total**:
- `docs/docs_overall/` (9 files, 1,516 lines) - Core documentation
- `docs/feature_deep_dives/` (18 files, 3,573 lines) - Feature implementation guides

**Key organizational pattern**: Each feature doc has a "Key Files" section that explicitly maps to source code:
- `tag_system.md` → `src/lib/services/tags.ts`, `explanationTags.ts`, `tagEvaluation.ts`
- `vector_search_embedding.md` → `src/lib/services/vectorsim.ts`
- `server_action_patterns.md` → `src/actions/actions.ts`

---

### 3. Existing Enforcement Mechanisms

The codebase has **12 enforcement mechanisms** via Claude hooks:

| Hook | Purpose | Blocking |
|------|---------|----------|
| `check-workflow-ready.sh` | Blocks edits until prerequisites met | Yes |
| `track-prerequisites.sh` | Auto-tracks when docs are read | Yes |
| `block-silent-failures.sh` | Prevents silent catch blocks | Yes |
| `block-supabase-writes.sh` | Forces DB changes through migrations | Yes |
| `block-manual-server.sh` | Enforces tmux server infrastructure | Yes |

**Key insight**: The prerequisite tracking system (`track-prerequisites.sh`) already tracks when `getting_started.md` and `project_workflow.md` are read. A similar pattern could track documentation updates.

---

### 4. Documentation Update Guidelines

**File**: `docs/docs_overall/instructions_for_updating.md`

**Must update when code changes**:
- All 18 `feature_deep_dives/*` files
- `architecture.md` (entire codebase overview)
- `testing_overview.md` (test infrastructure)
- `project_workflow.md` (processes)
- `environments.md` (CI/CD)
- `design_style_guide.md` (visual systems)

**Never update** (locked):
- `white_paper.md` (product philosophy)

---

### 5. Code-to-Doc Mapping Patterns

**No automated detection exists.** Current approach is entirely manual:

1. **Planning templates** require a "Documentation Updates" section listing docs to update
2. **Feature docs** have explicit "Key Files" sections (but not machine-readable)
3. **`instructions_for_updating.md`** describes what each doc covers (also not machine-readable)

**Gap**: No configuration file maps code files → relevant docs.

---

### 6. Existing Doc-Related Skills

**Skills found**:
- `plan-review` - Multi-agent review of planning docs (not feature docs)
- `plan-review-loop` - Iterative planning doc review with voting

**No skills exist for**:
- Updating feature documentation
- Detecting stale documentation
- Mapping code changes to docs

---

## Code References

- `.claude/commands/finalize.md` - Finalize command definition
- `.claude/hooks/check-workflow-ready.sh:1-182` - Workflow enforcement hook
- `.claude/hooks/track-prerequisites.sh:1-137` - Prerequisite tracking
- `docs/docs_overall/instructions_for_updating.md:1-39` - Doc update guidelines
- `docs/docs_overall/project_workflow.md:76-78` - Step 7 "Update all relevant documentation"

---

## Options for Implementation

### Option A: Advisory Step (Low Enforcement)
Add a documentation review step to `/finalize` that:
1. Lists all changed files via `git diff --name-only origin/main`
2. Suggests potentially relevant docs based on patterns
3. Asks user to confirm docs are updated (non-blocking)

**Pros**: Easy to implement, doesn't block workflow
**Cons**: Can be skipped, no verification

### Option B: Checklist with Confirmation (Medium Enforcement)
Add a step that:
1. Analyzes changed files
2. Uses mapping rules to suggest relevant docs
3. Requires explicit confirmation ("I've updated X" or "No update needed because Y")
4. Records confirmations in commit/PR

**Pros**: Creates audit trail, encourages thoughtful review
**Cons**: Still relies on user honesty

### Option C: Hook-Based Enforcement (High Enforcement)
Create a new hook that:
1. Reads changed files before PR creation
2. Checks if relevant docs were modified in the same branch
3. Blocks PR creation if expected docs weren't touched
4. Allows override with explicit justification

**Pros**: Enforces behavior, can't be accidentally skipped
**Cons**: May block legitimate PRs where no doc update needed

### Option D: AI-Assisted Doc Detection (Intelligent)
Add a step that:
1. Analyzes code changes semantically
2. Uses AI to determine if docs need updating
3. Suggests specific sections to update
4. Generates draft updates for review

**Pros**: Reduces manual work, catches non-obvious cases
**Cons**: More complex, may have false positives

---

## Mapping Rules Approach

To determine which docs need updating, use these patterns:

### By Directory
| Changed Path | Relevant Docs |
|--------------|---------------|
| `src/lib/services/tags*.ts` | `tag_system.md` |
| `src/lib/services/vectorsim.ts` | `vector_search_embedding.md` |
| `src/lib/services/links*.ts` | `link_whitelist_system.md` |
| `src/lib/services/metrics.ts` | `metrics_analytics.md` |
| `src/actions/actions.ts` | `server_action_patterns.md` |
| `src/editorFiles/*` | `lexical_editor_plugins.md`, `ai_suggestions_overview.md` |
| `tests/*` or `e2e/*` | `testing_setup.md`, `testing_overview.md` |
| `.github/workflows/*` | `environments.md` |
| `.claude/*` | `managing_claude_settings.md` |

### By Impact Type
| Change Type | Docs to Consider |
|-------------|------------------|
| New feature | Feature deep dive + `architecture.md` |
| API change | `server_action_patterns.md` + relevant feature doc |
| Schema change | `architecture.md` (Database Schema section) |
| Test infrastructure | `testing_overview.md`, `testing_setup.md` |
| Design system | `design_style_guide.md` |

---

## Recommended Approach

**Combine Options B + D (Intelligent Checklist)**:

1. Add new step to `/finalize` between step 4 (Commit) and step 5 (Push):

```markdown
### 4.5. Documentation Review

1. Get changed files: `git diff --name-only origin/main`
2. Apply mapping rules to identify potentially relevant docs
3. Check if those docs were modified in this branch
4. For each relevant doc:
   - If modified: ✓ Already updated
   - If not modified: Ask "Does [doc] need updating? (y/n/explain)"
5. Record decisions in a comment block in the PR description
```

2. Add a mapping configuration file (e.g., `.claude/doc-mapping.json`) for explicit rules

3. Use AI analysis as a fallback for files not covered by explicit rules

---

## Open Questions

1. Should the doc review step be blocking or advisory?
2. Should we require justification for "no update needed" decisions?
3. Should mapping rules be in code or configuration?
4. Should we generate draft doc updates automatically?
