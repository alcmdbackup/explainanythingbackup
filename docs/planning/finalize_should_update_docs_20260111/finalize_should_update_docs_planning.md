# Finalize Should Update Docs Plan

## Background

The `/finalize` command handles rebasing, running checks, and creating PRs but does not include documentation updates. The project workflow (Step 7) says to "Update all relevant documentation" but this is not enforced. Documentation drift occurs when code changes don't get reflected in docs.

## Problem

When developers run `/finalize` to create a PR, they may forget to update relevant documentation. There's no automated system to detect which docs need updating based on changed files, and no enforcement mechanism to ensure docs stay in sync with code.

## Solution

Add automatic documentation updates to `/finalize` that:
1. Analyze changed files using mapping rules + AI fallback
2. Generate and apply doc updates automatically (no manual review)
3. Block PR creation if doc-worthy changes exist but updates fail
4. Keep mapping rules updated via `/initialize` and gap detection in `/finalize`

---

## Phased Execution Plan

### Phase 1: Create Mapping Config

**Create `.claude/doc-mapping.json`:**

```json
{
  "version": "1.0",
  "mappings": [
    {
      "pattern": "src/lib/services/tags*.ts",
      "docs": ["docs/feature_deep_dives/tag_system.md"]
    },
    {
      "pattern": "src/lib/services/vectorsim.ts",
      "docs": ["docs/feature_deep_dives/vector_search_embedding.md"]
    },
    {
      "pattern": "src/lib/services/links*.ts",
      "docs": ["docs/feature_deep_dives/link_whitelist_system.md"]
    },
    {
      "pattern": "src/lib/services/metrics.ts",
      "docs": ["docs/feature_deep_dives/metrics_analytics.md"]
    },
    {
      "pattern": "src/lib/services/explanations*.ts",
      "docs": ["docs/feature_deep_dives/search_generation_pipeline.md"]
    },
    {
      "pattern": "src/lib/services/returnExplanation.ts",
      "docs": ["docs/feature_deep_dives/search_generation_pipeline.md"]
    },
    {
      "pattern": "src/lib/services/explanationSummarizer.ts",
      "docs": ["docs/feature_deep_dives/explanation_summaries.md"]
    },
    {
      "pattern": "src/actions/actions.ts",
      "docs": ["docs/feature_deep_dives/server_action_patterns.md"]
    },
    {
      "pattern": "src/editorFiles/**",
      "docs": [
        "docs/feature_deep_dives/lexical_editor_plugins.md",
        "docs/feature_deep_dives/ai_suggestions_overview.md"
      ]
    },
    {
      "pattern": "{tests,e2e}/**",
      "docs": ["docs/docs_overall/testing_overview.md"]
    },
    {
      "pattern": ".github/workflows/**",
      "docs": ["docs/docs_overall/environments.md"]
    },
    {
      "pattern": ".claude/**",
      "docs": ["docs/docs_overall/managing_claude_settings.md"]
    },
    {
      "pattern": "src/lib/utils/supabase/**",
      "docs": ["docs/feature_deep_dives/authentication_rls.md"]
    },
    {
      "pattern": "src/middleware.ts",
      "docs": ["docs/feature_deep_dives/authentication_rls.md"]
    },
    {
      "pattern": "src/lib/services/*Tracing*.ts",
      "docs": ["docs/feature_deep_dives/request_tracing_observability.md"]
    }
  ],
  "alwaysConsider": [
    "docs/docs_overall/architecture.md"
  ]
}
```

### Phase 2: Update instructions_for_updating.md

Add section at the end:

```markdown
## Automated Documentation Updates

Documentation updates are automatically handled by the `/finalize` command.

### How It Works
1. When you run `/finalize`, it analyzes all changed files
2. Mapping rules in `.claude/doc-mapping.json` determine which docs to update
3. AI generates and applies updates automatically
4. If changes are doc-worthy but updates fail, PR creation is blocked

### Mapping Configuration
See `.claude/doc-mapping.json` for the current file-to-doc mappings.

To add new mappings:
- During `/initialize`: You'll be prompted to specify affected docs
- During `/finalize`: If unmapped files are detected, you can add rules

### When Docs Are NOT Updated
The AI skips documentation updates for:
- Typo fixes and formatting changes
- Small bug fixes that don't change behavior
- Refactoring that doesn't affect public APIs
- Test-only changes (unless they affect testing_overview.md)
```

### Phase 3: Update finalize.md

Insert new step 4.5 between Commit Changes (step 4) and Push and Create PR (step 5):

```markdown
### 4.5. Documentation Updates

1. Get changed files:
   ```bash
   git diff --name-only origin/main
   ```

2. Load mapping rules from `.claude/doc-mapping.json`

3. For each changed file:
   - If matches a pattern → add mapped docs to update queue
   - If no match → continue (AI fallback happens next)

4. AI Analysis phase:
   - Read all changed files that had no mapping match
   - For each: "Is this a doc-worthy change? If yes, which doc?"
   - Trivial changes (typos, formatting, small bug fixes) → skip
   - Meaningful changes → add identified doc to queue

5. Always evaluate `alwaysConsider` docs:
   - For `architecture.md`: AI reviews all changes and updates if needed

6. For each doc in queue:
   - Read current doc content
   - Read relevant code diffs
   - Generate updated content preserving existing structure
   - Apply edit using Edit tool

7. Handle unmapped files with doc-worthy changes:
   - Ask: "Add mapping rule for [file] → [doc] for future?"
   - If yes → append to `.claude/doc-mapping.json`

8. If any doc updates were made:
   - Include in the step 4 commit (amend if already committed)

9. If doc-worthy changes exist but updates failed:
   - **Block** - do not proceed to push/PR
   - Display error and suggest manual intervention
```

### Phase 4: Update initialize.md

Insert new step 4.5 after folder creation:

```markdown
### 4.5. Documentation Mapping

1. First ask:
   "Will this project require a new feature deep dive document?"
   - Yes → prompt for doc name (e.g., `user_preferences.md`)
          → create template in `docs/feature_deep_dives/`
          → add mapping entry for it
   - No → continue

2. Ask which existing docs will be affected:
   "Which existing documentation files will this project likely affect?"

   Present checkboxes:
   - [ ] architecture.md (system design changes)
   - [ ] An existing feature_deep_dive (specify which)
   - [ ] testing_overview.md (test infrastructure)
   - [ ] environments.md (CI/CD, env vars)
   - [ ] Other (specify)

3. For new or selected docs, ask:
   "What code patterns will map to [doc]?"

   Suggest based on project name, e.g.:
   - Project "add_user_preferences" → suggest `src/lib/services/preferences*.ts`

4. Update `.claude/doc-mapping.json`:
   - Add new mapping entries
   - Validate patterns are valid globs
   - Commit mapping update with project setup
```

**New doc template** (if created):
```markdown
# [Feature Name]

## Overview
[To be filled during implementation]

## Key Files
- `src/lib/services/[service].ts` - [description]

## Implementation
[To be filled during implementation]
```

---

## Testing

### Manual Test Cases

1. **Mapped file change**: Modify `src/lib/services/tags.ts`, run `/finalize`, verify `tag_system.md` is updated
2. **Trivial change**: Fix typo in a service file, run `/finalize`, verify no doc update (AI skips)
3. **Unmapped file**: Create new service file, run `/finalize`, verify gap detection prompts for mapping
4. **New feature via initialize**: Run `/initialize new_feature`, verify prompted for doc mapping
5. **Blocking behavior**: Simulate doc update failure, verify PR creation blocked

### Edge Cases

- Multiple files mapping to same doc (should update once)
- File matching multiple patterns (should update all mapped docs)
- Changes only in test files (should only update testing docs if substantial)

---

## Documentation Updates

| File | Update |
|------|--------|
| `docs/docs_overall/instructions_for_updating.md` | Add "Automated Documentation Updates" section |
| `docs/docs_overall/managing_claude_settings.md` | Add reference to doc-mapping.json |

---

## Files Modified

| File | Action |
|------|--------|
| `.claude/doc-mapping.json` | Create (new) |
| `.claude/commands/finalize.md` | Modify (add step 4.5) |
| `.claude/commands/initialize.md` | Modify (add step 4.5) |
| `docs/docs_overall/instructions_for_updating.md` | Modify (add section) |
