---
description: "Analyze evolution codebase for refactoring and simplification opportunities"
---

## Scope
- Primary: `evolution/src/`
- Secondary: `evolution/scripts/`

## Agent Angles (4 per round)
1. **Dead Code Detection** — find functions, exports, types, and files that are never imported or referenced
2. **Dependency Graph** — map import chains, identify circular dependencies, find overly coupled modules
3. **Complexity Hotspots** — find files with high cyclomatic complexity, deep nesting, or long functions
4. **API Surface Audit** — catalog public exports vs internal usage, find opportunities to reduce surface area

## Key Questions
- What code paths are unreachable from any entry point?
- Which modules have the most incoming/outgoing dependencies?
- Are there duplicate implementations of similar logic?
- What V1 legacy code can be safely removed?
