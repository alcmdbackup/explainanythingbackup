---
description: "Find stale, missing, or inaccurate documentation across the project"
---

## Scope
- Primary: `docs/` (feature deep dives, getting started, architecture)
- Secondary: `evolution/docs/` (pipeline-specific docs)

## Agent Angles (4 per round)
1. **Stale Documentation** — find docs that reference removed features, old API signatures, or outdated file paths
2. **Missing Feature Docs** — identify features in the codebase that have no corresponding documentation
3. **Broken References** — find internal links, code references, and file paths in docs that no longer resolve
4. **Accuracy Audit** — compare docs claims (architecture, data flow, config) against actual implementation

## Key Questions
- Which feature deep dives describe behavior that no longer matches the code?
- Are there major features or subsystems with no documentation at all?
- Do the architecture docs reflect the current module structure?
- Are CLI flags, env vars, and config options documented accurately?
