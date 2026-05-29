# Autologin Broken 3rd Night After Fix Research

## Problem Statement
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## Requirements (from GH Issue #NNN)
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## High Level Summary
[To be completed during /research. Preliminary leads below from the doc sweep — verify each against current code/config before treating as fact.]

### Mechanism (how autologin works today)
- Public demo auto-signs every session-less visitor into ONE shared Supabase guest account (`guest@explainanything.app`) via `signInWithPassword({ email: GUEST_EMAIL, password: GUEST_PASSWORD })` in `src/lib/utils/supabase/middleware.ts`.
- The shared password must stay byte-identical across MANY places or autologin breaks: Dev Supabase auth row, Prod Supabase auth row, Vercel `GUEST_PASSWORD` (prod + staging, both `type=sensitive`), GitHub Actions `staging` env secret, and `.env.local` in each worktree. Vercel snapshots env at deploy time, so a value change requires a redeploy.

### Candidate root causes for "automated overnight" breakage (to confirm/refute)
1. **Password-reset takeover of the guest account.** `authentication_rls.md` documents a known risk: because a visitor is auto-logged-in as the shared guest, a naive `/reset-password` would let anyone overwrite the guest password. Three gates defend it; the server-side gate depends on `process.env.GUEST_USER_ID` being set *per tier*. The memory note records a prior incident where `GUEST_USER_ID` was missing on a tier and the gate failed open. **Verify `GUEST_USER_ID` is set on prod Vercel.** If a crawler/bot can drive the recovery flow, this is the most plausible "automated" cause.
2. **Nightly E2E suite mutating the guest password.** `e2e-nightly.yml` runs daily at 06:00 UTC against the **live production URL** with real auth and **no `E2E_TEST_MODE`** (so guest auto-login is ACTIVE during the run). The "3rd night" recurrence pattern correlates strongly with a nightly cron. Audit whether any nightly-included spec (esp. `password-reset.spec.ts` / auth specs) calls `updateUser({ password })`, `admin.generateLink`, or `admin.updateUserById` against the guest account or a user whose mutation cascades to the guest session. Docs claim password-reset E2E uses dedicated `admin.createUser` users — confirm that's actually true on the production run path.
3. **Incomplete manual rotation drift.** Memory asserts "no automated job resets the password — drift is always from an incomplete manual rotation." The user is adamant they changed nothing; reconcile this against (1) and (2). Even if no human rotated it, an automated flow (1 or 2) effectively performs a rotation that desyncs the other stores.
4. **Supabase scheduled task / Vercel cron** performing a reset. No such job is known from docs/memory — enumerate Supabase dashboard scheduled jobs, Postgres `cron.job`, and Vercel crons to rule out.

### Prevention directions (to develop in planning)
- Make `GUEST_USER_ID` presence on every tier a hard, monitored invariant (fail-closed reset gate + a check that alerts when missing).
- Ensure nightly/prod test runs cannot touch the guest credentials (dedicated users only; assert guest email is never the subject of a password mutation; consider `E2E_TEST_MODE`/guest-skip for prod auth specs).
- Make guest-password rotation atomic across all stores (single script that updates Supabase + pushes to all Vercel targets + redeploys), or move the secret to a single source (Supabase Vault). [from memory's "permanent fix idea"]
- Add a synthetic monitor that performs the guest autologin against prod on a schedule and alerts the moment it fails — turns a silent overnight break into an immediate page.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (most load-bearing for this issue)
- docs/feature_deep_dives/authentication_rls.md (guest auto-login mechanism + password-reset takeover gates — PRIMARY)
- docs/docs_overall/environments.md (guest env vars, Vercel targets, nightly cron, GitHub secrets, website topology)
- docs/docs_overall/debugging.md (Sentry/Honeycomb/prod DB query tooling for diagnosis)
- docs/docs_overall/testing_overview.md (nightly workflow, @prod-ai/@skip-prod tags, E2E_TEST_MODE)
- docs/feature_deep_dives/testing_setup.md (e2e-nightly.yml details, secrets, prod run behavior)

### Other Non-Evolution Docs Read (per request: "read all non evolution docs")
- docs/docs_overall/cloud_env.md
- docs/docs_overall/managing_claude_settings.md
- docs/docs_overall/instructions_for_updating.md
- docs/docs_overall/llm_provider_limits.md
- docs/docs_overall/design_style_guide.md
- docs/docs_overall/white_paper.md
- docs/feature_deep_dives/pr_verification_gate.md
- docs/feature_deep_dives/request_tracing_observability.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/maintenance_skills.md
- docs/feature_deep_dives/debugging_skill.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/user_testing.md
- docs/feature_deep_dives/iterative_planning_agent.md
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/writing_pipeline.md
- docs/feature_deep_dives/realtime_streaming.md
- docs/feature_deep_dives/vector_search_embedding.md
- docs/feature_deep_dives/tag_system.md
- docs/feature_deep_dives/state_management.md
- docs/feature_deep_dives/metrics_analytics.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/feature_deep_dives/ai_suggestions_overview.md
- docs/feature_deep_dives/add_sources_citations.md
- docs/feature_deep_dives/manage_sources.md
- docs/feature_deep_dives/explanation_summaries.md
- docs/feature_deep_dives/lexical_editor_plugins.md
- docs/feature_deep_dives/link_whitelist_system.md
- docs/feature_deep_dives/markdown_ast_diffing.md

## Code Files Read
- [To be populated during /research — start with: src/lib/utils/supabase/middleware.ts, src/app/reset-password/page.tsx, src/app/login/actions.ts, src/app/auth/confirm/route.ts, .github/workflows/e2e-nightly.yml, scripts/seed-guest-user.ts]
