## Problem Statement
Identify flaky E2E and integration tests across the suite and fix their root causes (race conditions, missing waits, mock cleanup, etc.) following the testing rules in `docs/docs_overall/testing_overview.md`. Stabilize CI by ensuring tests pass deterministically on reruns.

## Requirements (from GH Issue #NNN)
- Identify flaky tests via CI history (recent failures, retries, intermittent passes)
- Reproduce each candidate locally (loop runs against the dev tmux server)
- Root-cause each failure (no symptom-only patches per `/debug` skill)
- Fix per testing rules (`testing_overview.md` Rules 1-18: stable selectors, auto-waiting assertions, no `networkidle`, no fixed sleeps, route mock cleanup, hydration waits, etc.)
- Verify each fix by rerunning the previously flaky test multiple times
- Update docs (`testing_overview.md` rules section, `testing_setup.md` patterns) if new patterns emerge
- Confirm `npm run test:e2e:critical` and `npm run test:integration` are green locally before PR

## High Level Summary
[To be filled during /research]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (manually tagged)
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md

## Code Files Read
- [to be populated during /research]
