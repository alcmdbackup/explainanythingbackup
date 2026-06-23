# Look For CI Flakiness Stability Issues Plan

## Background
Look at recent CI runs as well as `docs/docs_overall/testing_overview.md`, `docs/docs_overall/environments.md`, and `docs/feature_deep_dives/testing_setup.md` and look for ways to make tests less flaky and more reliable. Amend the testing overview if necessary with any new findings.

## Requirements (from GH Issue #NNN)
- Look at recent CI runs (GitHub Actions: `ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, `supabase-migrations.yml`) to identify recurring flakiness / stability patterns.
- Review the three named docs for existing flakiness rules and coverage gaps:
  - `docs/docs_overall/testing_overview.md`
  - `docs/docs_overall/environments.md`
  - `docs/feature_deep_dives/testing_setup.md`
- Look for concrete, systematic ways to make tests (unit / ESM / integration / E2E) less flaky and more reliable.
- Amend `docs/docs_overall/testing_overview.md` (and adjacent docs) if necessary with any new findings — prefer systematic + enforceable (ESLint rule / hook / CI check) mechanisms over one-off patches.

## Problem
[3-5 sentences describing the problem — refine after /research. Initial: CI flakiness erodes signal (real failures get retried away; flakes burn reviewer time and erode trust in the gate). The repo already has an extensive flakiness rule set + ESLint enforcement, so the highest-leverage work is finding the gaps that recent runs actually exercised and either closing them with new enforced rules or documenting them.]

## Options Considered
- [ ] **Option A: Docs-only amendment**: Mine recent run history + the 3 docs, then add any new flakiness findings/rules to `testing_overview.md`. Lowest blast radius; no code change. Risk: rules without enforcement drift.
- [ ] **Option B: Docs + new ESLint/CI enforcement**: For each new finding that is mechanically detectable, add a `flakiness/*` ESLint rule or CI check alongside the doc rule (matches the existing enforcement-table convention). Higher effort, durable.
- [ ] **Option C: Quarantine/auto-detect harness**: Add tooling to detect flaky tests from run history (retry-on-first-attempt signal) and surface/quarantine them. Largest scope; may be follow-up.

## Phased Execution Plan

### Phase 1: Evidence gathering (recent runs + docs)
- [ ] Pull recent run history via `gh run list` / `gh run view` for `ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, `supabase-migrations.yml`; capture failures that passed on retry (flake signal) vs hard failures.
- [ ] Cross-reference failures against the 19 existing flakiness rules in `testing_overview.md` — bucket each into (already-covered / gap / env-specific).
- [ ] Record findings in `_research.md` High Level Summary with run IDs / dates as evidence.

### Phase 2: Identify systematic improvements
- [ ] For each gap, decide enforcement tier: ESLint `flakiness/*` rule, Claude hook, CI check, or docs-only guidance.
- [ ] Confirm each proposed change is systematic + scalable (not a one-off retry/timeout bump).

### Phase 3: Implement + document
- [ ] Implement any agreed enforcement (rule/hook/check) with unit tests per CLAUDE.md (lint/tsc/build/tests after each block).
- [ ] Amend `testing_overview.md` (Rules list + Enforcement Summary table) with new findings; touch `testing_setup.md` / `environments.md` / `cloud_env.md` only where the finding lives there.

## Testing

### Unit Tests
- [ ] If a new ESLint `flakiness/*` rule is added: `eslint-rules/<rule>.test.ts` (or repo's rule-test location) — valid/invalid fixtures.
- [ ] If a new script/check is added: colocated `*.test.ts` covering pass + fail cases.

### Integration Tests
- [ ] [Likely none — this project is docs + lint/CI tooling. Confirm during /research.]

### E2E Tests
- [ ] [Likely none. If a flakiness fix touches an existing spec, re-run that spec 5× for stability per local-first CI retry policy.]

### Manual Verification
- [ ] Run `npm run lint` to confirm any new `flakiness/*` rule loads and fires on a seeded violation.
- [ ] Re-run the historically-flaky spec(s) identified in Phase 1 locally 5× to confirm stability.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless a fix edits an E2E spec — if so, run that spec on the local tmux server.

### B) Automated Tests
- [ ] `npm run lint` (new flakiness rules), `npm run typecheck`, plus the standard /finalize check trio.
- [ ] Any new rule/check unit test: `npm test -- <path>`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/testing_overview.md` — PRIMARY amend target: add new flakiness rules + Enforcement Summary rows.
- [ ] `docs/feature_deep_dives/testing_setup.md` — update if a finding concerns fixtures/mocking/test infra.
- [ ] `docs/docs_overall/environments.md` — update if a finding concerns CI/CD workflow config or secrets.
- [ ] `docs/docs_overall/cloud_env.md` — update if a finding concerns web/CI proxy/network reliability.
- [ ] `docs/feature_deep_dives/error_handling.md` — update if a finding concerns transient-error/retry classification.
- [ ] `docs/feature_deep_dives/request_tracing_observability.md` — update if observability is leveraged to diagnose flakes.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
