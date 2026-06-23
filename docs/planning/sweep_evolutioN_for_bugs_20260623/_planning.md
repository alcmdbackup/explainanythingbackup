# sweep_evolutioN_for_bugs_20260623 Plan

## Background
Evolution pipeline is the most complex subsystem (V2 pipeline: variant generation, arena rating, criteria agents, paragraph recombine, coherence pass, etc.). It has accumulated breadth and a long tail of bugs that recur in production. A sweep of code-readable bug discovery will surface latent defects before they cause cost blowouts, silent quality regressions, or 0-variant runs.

## Requirements (from GH Issue #TBD)
find 100 bugs on evolution by reading codebase, re-check them to verify-they are bugs, then fix all critical, high and medium bugs

## Problem
Bugs in the evolution codebase recur and are often discovered reactively (failed runs, cost spikes, evolved-content quality dips). A proactive read-driven sweep — followed by adversarial verification and triage — should catch a large batch before they cause incidents. Low-severity findings remain documented but unfixed.

## Options Considered
- [ ] **Option A: Solo serial sweep** — read evolution files one-by-one, log candidates, verify each, fix in order. Simple but slow and likely to miss cross-file invariants.
- [ ] **Option B: Multi-agent parallel sweep + adversarial verify** — fan out finders across subsystems (variant generation, arena, criteria, recombine, coherence, prompt editor, logging, cost tracking), each producing candidate bugs with file:line + repro/reasoning; second-pass adversarial verifiers attempt to refute each candidate; survivors get triaged (Critical/High/Medium/Low) and fixed in severity order. Higher recall, catches dimensional gaps, matches the "100 bugs" scale request.

## Phased Execution Plan

### Phase 1: Research & Scope
- [ ] Read all evolution docs (`evolution/docs/*.md`) + standard docs (`docs/docs_overall/*.md`)
- [ ] Inventory evolution code surface (paths, entry points, recent incident memory)
- [ ] Populate `_research.md` with subsystem map + known-bug priors (from memory + recent commits)

### Phase 2: Bug Discovery (target: 100 candidates)
- [ ] Fan out finders per subsystem dimension (correctness, cost-tracking, error-handling-correctness, concurrency, schema/DB, prompt-correctness, logging, observability, security, type-safety)
- [ ] Each finder returns structured candidates: `{file, line, title, repro, severity_guess, category}`
- [ ] Dedupe by (file, line, category)

### Phase 3: Adversarial Verification
- [ ] Each candidate: independent verifier attempts to refute (default to "not a bug" unless evidence holds)
- [ ] Survivors get severity assigned (Critical / High / Medium / Low) with explicit blast-radius reasoning
- [ ] Quarantine "Low" findings into a separate list (documented, not fixed)

### Phase 4: Fix Critical / High / Medium
- [ ] Group survivors by file/area, fix in severity order
- [ ] Each fix gets a unit/integration test that fails-before / passes-after
- [ ] Lint + tsc + build + test after each fix batch (per CLAUDE.md)

### Phase 5: Wrap-up
- [ ] Full check trio (lint, tsc, build, unit, integration, E2E critical)
- [ ] Update progress doc with verified-bug list + fix mapping
- [ ] Open PR

## Testing

### Unit Tests
- [ ] Per-fix unit tests under the relevant module's `*.test.ts` (TBD as bugs surface)

### Integration Tests
- [ ] Cost-tracking / DB-write fixes get integration coverage in `evolution/integration/`

### E2E Tests
- [ ] Reuse existing critical evolution E2Es (`tests/e2e/critical/`) — add specs only when a fix is not covered

### Manual Verification
- [ ] Spot-check a real evolution pipeline run end-to-end after fixes land

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless a fix touches the prompt editor or visualization UI

### B) Automated Tests
- [ ] `npm run lint && npm run tsc && npm run build`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e:critical`

## Documentation Updates
- [ ] `evolution/docs/` — update any doc that described now-fixed broken behavior
- [ ] CLAUDE.md memory — capture surprising bug patterns worth remembering

## Review & Discussion
[Populated by /plan-review]
