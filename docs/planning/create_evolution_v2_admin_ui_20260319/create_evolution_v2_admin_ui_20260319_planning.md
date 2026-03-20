# Create Evolution V2 Admin UI Plan

## Background
Restore the evolution admin dashboard and supporting pages that were deleted in PR #736 (V1 cleanup). PR #736 correctly identified that V1 code referenced dropped V2 schema columns, but over-corrected by deleting the entire admin UI instead of surgically updating it. This project reverts PR #736's deletions, updates restored code to work with the current V2 schema (strategy_config_id as FK, no inline config JSONB, arena table renames), and removes only code that truly cannot work with V2.

## Requirements
1. Revert all file deletions from PR #736 to restore the previous working admin UI
2. Update restored server actions to use V2 schema (strategy_config_id FK, no config JSONB column on runs, arena table renames, evolution_explanations)
3. Restore all pages: evolution-dashboard, runs list + run detail (6 tabs), variants list + detail, invocations list + detail, strategies list + detail (CRUD), prompts list + detail (CRUD), arena pages
4. Remove code referencing dropped V1 columns/tables that cannot be adapted to V2
5. Update imports to use V2 action files (experimentActionsV2.ts) where PR #736 created replacements
6. Reuse existing V2 shared components (EntityDetailHeader, EntityTable, MetricGrid, etc.)
7. Ensure all restored pages pass lint, tsc, build with unit tests
8. Update visualization.md and admin_panel.md docs

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Update page routes, component lists, action lists for V2
- `evolution/docs/evolution/reference.md` - Update key files section
- `evolution/docs/evolution/data_model.md` - Verify data model references match restored code
- `docs/feature_deep_dives/admin_panel.md` - Update routes, sidebar items, evolution dashboard patterns
- `evolution/docs/evolution/architecture.md` - Verify pipeline references
- `evolution/docs/evolution/experimental_framework.md` - Verify metrics UI references
- `docs/feature_deep_dives/server_action_patterns.md` - Update if new actions added
- `evolution/docs/evolution/arena.md` - Update admin UI section
- `docs/docs_overall/design_style_guide.md` - No changes expected
- `evolution/docs/evolution/rating_and_comparison.md` - No changes expected
