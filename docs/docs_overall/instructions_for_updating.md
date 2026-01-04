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

All 17 files should be updated when their corresponding features change:
- Deep dive on specific relevant parts of the code
- Update code examples if APIs change
- Keep file counts and statistics current

## Archive

Files in `/docs/archive/` are historical and should NOT be updated:
- `backend_explorations/` - Historical RFCs
- `explorations/` - Historical UX research
- `meta/` - Claude usage analysis
