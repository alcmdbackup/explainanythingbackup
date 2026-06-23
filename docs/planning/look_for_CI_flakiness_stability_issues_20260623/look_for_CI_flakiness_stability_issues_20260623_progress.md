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
- Q1–Q4 resolved (AskUserQuestion): Option B + fix specs; nightly triage = embed test names in issue; threshold `N <= 10000`.

### Broad sweep (2026-06-23, "any other flakiness sources?")
- Ran 4 parallel agents over ~18 recent CI failures (logs recovered via `gh api .../jobs/<id>/logs`) + all 7 scheduled workflows (nightly failures recovered from non-expired Playwright report artifacts).
- **Found 5 distinct flakiness sources** (S1–S5 in `_research.md`), two higher-impact than the original `toBeVisible` cluster:
  - **S1 webServer startup timeout** — ~20% of failed CI runs; whole-job red; root = `npm run build && npm start` under one webServer timeout. Timeout already bumped 180→240s (PR #1258, 06-22); structural fix = decouple build into a CI step. NOT in original plan.
  - **S2 nightly real-AI transient failures** — the actual cause of nightly red (06-07/06-19/06-22): `action-buttons save-to-library` AI-streaming error + evolution real-run 402/429 wipeout. Real-AI-only (can't repro in mocked PR-CI).
  - **S3** the 09-admin cluster is chronic (`iterative-editing:189` flaky in 8 runs) — strengthens original finding.
  - **S4** integration (Evolution) 429/503 noise (3 runs).
  - **S5** `Verify Seed Reuse` workflow has 0 lifetime runs (dead coverage).
- Distinguished from flakes: real recurring bugs (`character varying(255)` RPC drift ×4 runs incl. a 10-spec wipeout; `schema_migrations_pkey` ×2; `Module not found 'fs'` ×1) and benign non-issues (post-deploy-smoke skips; real-AI cheap smoke 20/20 green).
- New scope questions Q5–Q8 raised for the user (fold S1 in? document vs fix S2? investigate S4? fix/remove S5?).

## Phase 2: Identify systematic improvements
### Work Done
[Description]

## Phase 3: Implement + document
### Work Done
[Description]
