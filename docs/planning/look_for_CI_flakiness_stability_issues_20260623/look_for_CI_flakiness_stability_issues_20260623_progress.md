# Look For CI Flakiness Stability Issues Progress

## Phase 1: Evidence gathering (recent runs + docs)
### Work Done
- `/research` complete (2026-06-23). Pulled run history for CI / nightly / smoke / real-AI-smoke via `gh run list`/`gh run view`; mined a live CI failure's job logs (`27996587814`).
- Mapped existing enforcement: 17 `flakiness/*` ESLint rules + scoping (`eslint.config.mjs`), 2 hooks, `check-stale-specs`, Playwright retry/timeout/reporter config.
- Audited the 5 flaky evolution-admin specs; identified 3 root-cause patterns (missing hydration proof, data-seeding race + sub-default timeout, missing filter reset).
- Identified 3 systemic gaps: hydration-rule blind spot for inline specs, sub-default hardcoded expect timeouts, retry-masked flakes never surfaced + detail-free nightly issues.
- Findings written to `_research.md` (High Level Summary + Key Findings + Open Questions).

### Issues Encountered
- GH Actions logs for the nightly failures (06-19, 06-22) had expired → root cause uncaptured; reinforces gap #3 (no durable failure detail).
- PAT lacks `check-runs` API scope → used job logs + auto-filed issues instead of annotations.

### User Clarifications
- (pending /plan-review) Open Questions #1–#4 in `_research.md` — scope (docs-only vs docs+enforcement), whether to fix live specs, nightly-triage depth, timeout-rule threshold.

## Phase 2: Identify systematic improvements
### Work Done
[Description]

## Phase 3: Implement + document
### Work Done
[Description]
