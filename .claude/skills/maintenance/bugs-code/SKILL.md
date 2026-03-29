---
description: "Read through codebase to find bugs, error handling gaps, and logic errors"
---

## Scope
- Primary: `evolution/src/`, `src/app/api/`
- Secondary: `src/lib/`, `evolution/scripts/`

## Agent Angles (4 per round)
1. **Error Handling Gaps** — find try/catch blocks that swallow errors, missing error propagation, unhandled promise rejections
2. **Race Conditions** — identify shared mutable state, concurrent DB operations without locks, missing awaits
3. **Null/Undefined Risks** — find optional chaining gaps, missing null checks on DB results, unsafe destructuring
4. **Logic Errors** — check boundary conditions, off-by-one errors, incorrect comparisons, unreachable branches

## Key Questions
- Are there async operations that could fail silently?
- Do database transactions properly handle partial failures?
- Are there places where `undefined` could propagate and cause downstream crashes?
- Do conditional branches cover all expected cases (especially switch/case with no default)?
