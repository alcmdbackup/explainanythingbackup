# Fix Still Broken Nightly E2EE Progress

## Phase 1: Forensics (read-only) — COMPLETE (2026-06-07)
### Work Done
Ran 3 rounds × 4 parallel agents (12 total). Established:
- Prior nightly fixes are on BOTH main + production (shipped PR #1146, 2026-05-31) and worked — nightly green 06-01→06-06. Starting "unpromoted fix" hypothesis DISPROVEN.
- Only 06-07 is red; root cause = OpenAI account-quota 429 (`429 You exceeded your current quota`), confirmed via prod `evolution_logs.context.error` (8 runs `status='failed'`, `Seed generation failed`).
- Trigger = Judge Lab #1170 batch sweeps draining the shared `OPENAI_API_KEY`; staging 429'd 6.5h before prod (account-level, not prod-specific).
- Quota recovered (live OpenAI probe returns 200).
- Adversarial refutation: root cause survives at ~90% (6 alternatives refuted).
- Exactly 3 real-AI blocking specs identified; `@prod-ai` is the inert intended isolation lever.
- Fix design validated (single-regex `--grep-invert`, seeded action-buttons refactor, non-blocking lane needs own alert; would have made 06-07 green).
Full detail in `_research.md`.

### Issues Encountered
- `gh run view --log-failed` returned empty (CLI quirk); worked around via `gh api .../actions/jobs/<id>/logs`.
- PAT lacks `checks` scope (403 on check-runs API); worked around via jobs-logs API. No data lost.
- Prod cost-telemetry tables empty (documented audit-gap since 2026-02-23) — limits spend forensics; the 429 evidence came from `evolution_logs` instead.

### User Clarifications
- User requested the investigation be run as 3 rounds of 4 agents each (done).

## Phase 2: Root-cause + fix
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

### User Clarifications
[Questions asked and answers received]

## Phase 3: Verify + harden
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

### User Clarifications
[Questions asked and answers received]
