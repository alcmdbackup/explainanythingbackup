# sweep_evolutioN_for_bugs_20260623 Plan

## Background
Evolution pipeline is the most complex subsystem (V2 pipeline: variant generation, arena rating, criteria agents, paragraph recombine, coherence pass, etc.). It has accumulated breadth and a long tail of bugs that recur in production. A sweep of code-readable bug discovery will surface latent defects before they cause cost blowouts, silent quality regressions, or 0-variant runs.

## Requirements (from GH Issue #1262)
find 100 bugs on evolution by reading codebase, re-check them to verify-they are bugs, then fix all critical, high and medium bugs

## Problem
Bugs in the evolution codebase recur and are often discovered reactively (failed runs, cost spikes, evolved-content quality dips). A proactive read-driven sweep — followed by adversarial verification and triage — should catch a large batch before they cause incidents. Low-severity findings remain documented but unfixed.

## Options Considered
- [x] **Option A: Solo serial sweep** — read evolution files one-by-one, log candidates, verify each, fix in order. Simple but slow and likely to miss cross-file invariants.
- [x] **Option B: Multi-agent parallel sweep + adversarial verify** — fan out finders across subsystems (variant generation, arena, criteria, recombine, coherence, prompt editor, logging, cost tracking), each producing candidate bugs with file:line + repro/reasoning; second-pass adversarial verifiers attempt to refute each candidate; survivors get triaged (Critical/High/Medium/Low) and fixed in severity order. Higher recall, catches dimensional gaps, matches the "100 bugs" scale request.

## Phased Execution Plan

### Phase 1: Research & Scope
- [x] Read all evolution docs (`evolution/docs/*.md`) + standard docs (`docs/docs_overall/*.md`)
- [x] Inventory evolution code surface (paths, entry points, recent incident memory)
- [x] Populate `_research.md` with subsystem map + known-bug priors (from memory + recent commits)

### Phase 2: Bug Discovery (target: 100 candidates)
- [x] Fan out finders per subsystem dimension (correctness, cost-tracking, error-handling-correctness, concurrency, schema/DB, prompt-correctness, logging, observability, security, type-safety)
- [x] Each finder returns structured candidates: `{file, line, title, repro, severity_guess, category}`
- [x] Dedupe by (file, line, category)

### Phase 3: Adversarial Verification
- [x] Each candidate: independent verifier attempts to refute (default to "not a bug" unless evidence holds)
- [x] Survivors get severity assigned (Critical / High / Medium / Low) with explicit blast-radius reasoning
- [x] Quarantine "Low" findings into a separate list (documented, not fixed)

### Phase 4: Fix Critical / High / Medium
- [x] Group survivors by file/area, fix in severity order
- [x] Each fix gets a unit/integration test that fails-before / passes-after
- [x] Lint + tsc + build + test after each fix batch (per CLAUDE.md)

### Phase 5: Wrap-up
- [x] Full check trio (lint, tsc, build, unit, integration, E2E critical)
- [x] Update progress doc with verified-bug list + fix mapping
- [x] Open PR

## Testing

### Unit Tests
- [x] Per-fix unit tests under the relevant module's `*.test.ts` (TBD as bugs surface)

### Integration Tests
- [x] Cost-tracking / DB-write fixes get integration coverage in `evolution/integration/`

### E2E Tests
- [x] Reuse existing critical evolution E2Es (`tests/e2e/critical/`) — add specs only when a fix is not covered

### Manual Verification
- [x] Spot-check a real evolution pipeline run end-to-end after fixes land

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A unless a fix touches the prompt editor or visualization UI

### B) Automated Tests
- [x] `npm run lint && npm run tsc && npm run build`
- [x] `npm run test:unit`
- [x] `npm run test:integration`
- [x] `npm run test:e2e:critical`

## Documentation Updates
- [x] `evolution/docs/` — update any doc that described now-fixed broken behavior
- [x] CLAUDE.md memory — capture surprising bug patterns worth remembering

## Review & Discussion
[Populated by /plan-review]
