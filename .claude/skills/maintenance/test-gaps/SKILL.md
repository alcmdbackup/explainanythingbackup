---
description: "Identify gaps and issues in test coverage for the evolution pipeline"
---

## Scope
- Primary: `evolution/src/` (source) and `evolution/src/__tests__/` (tests)
- Secondary: CI config (`.github/workflows/`), `jest.config.*`, `playwright.config.*`

## Agent Angles (4 per round)
1. **Uncovered Code Paths** — find functions and branches in `evolution/src/` with no corresponding test assertions
2. **Missing Edge Cases** — for existing tests, identify missing error/boundary/null cases
3. **CI Config Analysis** — compare what runs on pushes to main vs production; identify gaps in gate coverage
4. **Flaky Test Patterns** — find tests with timing dependencies, shared mutable state, or non-deterministic assertions

## Key Questions
- Which evolution source files have zero test coverage?
- Are there critical paths (run execution, LLM calls, DB writes) without integration tests?
- Do main-branch CI checks differ from production checks?
- Are there tests that pass locally but fail in CI (or vice versa)?
