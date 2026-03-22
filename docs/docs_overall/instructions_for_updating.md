# Instructions for Updating Documentation

Periodically, we need to ensure key docs are up to date.

## Guidelines
- Follow guidance below on which parts of codebase to reference for each doc
- Keep updates concise and precise

## What Must Be Updated

### docs_overall/

| File | Update Scope | Notes |
|------|--------------|-------|
| `architecture.md` | Entire codebase | Vision, data flow, feature index, tech stack |
| `getting_started.md` | Navigation structure | Only if new docs added/removed |
| `testing_overview.md` | Testing infrastructure | Commands, tiers, rules |
| `project_workflow.md` | Project process | Templates, steps |
| `design_style_guide.md` | Visual design | Theme, components |
| `environments.md` | Environment config | CI/CD, secrets |
| `managing_claude_settings.md` | Claude settings | Only if settings change |

### Do NOT Update
- `white_paper.md` - Locked product philosophy
- `instructions_for_updating.md` - Meta doc (this file)

### feature_deep_dives/

All 15 files should be updated when their corresponding features change (9 evolution docs moved to `evolution/docs/evolution/`):
- Deep dive on specific relevant parts of the code
- Update code examples if APIs change
- Keep file counts and statistics current

### evolution/

14 files covering the V2 evolution pipeline system:
- `README.md` — Index and reading order
- `architecture.md`, `data_model.md`, `rating_and_comparison.md` — Core pipeline docs
- `agents/overview.md` — V2 operations (generate, rank, evolve)
- `arena.md`, `cost_optimization.md`, `visualization.md` — Infrastructure docs
- `entity_diagram.md` — Entity relationship diagram
- `strategy_experiments.md`, `experimental_framework.md` — Experiment system
- `curriculum.md` — Learning path for the codebase
- `reference.md` — Cross-cutting concerns (config, schema, files, CLI)
- `minicomputer_deployment.md` — Batch runner deployment guide

## Archive

Files in `/docs/archive/` are historical and should NOT be updated:
- `backend_explorations/` - Historical RFCs
- `explorations/` - Historical UX research
- `meta/` - Claude usage analysis

---

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
