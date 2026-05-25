# fixes_explainanything_for_public_demo_20260523 Research

## Problem Statement

Prepare the ExplainAnything public-facing site (not the evolution pipeline) for a public demo. Smooth out user-visible rough edges — link generation, streaming-completion UX, demo guest access — and rotate the admin password. Also audit the paid services so we know what credits we need.

## Requirements (from GH Issue #NNN)

1. **Scope**: All changes target the ExplainAnything public site only, NOT the evolution pipeline / `/admin/evolution/*` routes.
2. **Links — bypass whitelist for the demo**: Make sure inline links get generated in the article body. Bypass the `link_whitelist` requirement entirely for now (link any AI-suggested term), but **keep the whitelist + candidate-approval code in place** so we can re-enable it later without re-implementing.
3. **Post-streaming hand-off UX — floating status pill** (decisions locked):
   - Floating pill at `bottom-center`, `position: fixed`, paper-texture + backdrop-blur + warm shadow, 2px left accent stripe (gold → success per state).
   - **A — Streaming**: `Drafting your article — hang tight…`
   - **B — Transition** (~800ms): `All set! Bringing the editor in…`
   - **C — One-time hint** (auto-dismiss 3s or ✕): `Try: "explain it like I'm 12" — AI editor →` (the concrete prompt deliberately points demo viewers toward `AIEditorPanel` so they discover the differentiating AI-editing feature in their first session).
   - Driven by `pageLifecycleReducer` phase; respects `prefers-reduced-motion`.
4. **Rotate admin password**: One-time ops task — change the prod admin user's Supabase Auth password.
5. **Demo guest account + auto-login** (decisions locked):
   - One shared Supabase Auth user (NOT anon-per-visitor); commingling accepted.
   - Auto-login in `src/middleware.ts` via in-place `signInWithPassword` server-side; session cookies written onto the outgoing response. No redirect. Gated to public hostname.
   - `/login` redirects to `/` when guest session active; sign-out button hidden on public site.
   - Pre-seed guest's `userLibrary` via `scripts/seed-guest-library.ts` that **freshly generates** 5-10 explanations through the normal pipeline. **Topic: semiconductors & GPUs.**
   - No cleanup CRON — accept that guest data accumulates.
   - LLM spending-gate per-user cap on guest: **$10/day**.
   - Credentials: `GUEST_EMAIL=guest@explainanything.app` + `GUEST_PASSWORD` (generated) in Vercel env vars + `.env.local`.

### Starter query list for `scripts/seed-guest-library.ts` (refine during `/research`)

A spread across fundamentals, comparison, software, manufacturing, economics, and specialized topics:

1. How does a transistor work?
2. What's the difference between a CPU and a GPU?
3. How does CUDA enable parallel computing?
4. What is EUV lithography and why does it matter?
5. Why are chip fabs so expensive to build?
6. What is Moore's Law and is it still true?
7. How does High Bandwidth Memory (HBM) work?
8. How do tensor cores accelerate AI workloads?
9. What is chiplet architecture and why is everyone moving to it?
10. Why has Nvidia become dominant in AI hardware?

Goal: each is a single sentence, evergreen, technically meaty enough to showcase the AI editor's "explain like I'm 12 / make it sharper / add an example" demo prompts on real content.

6. **Paid-services inventory**: Audit and list every external service we pay for via credits (OpenAI, Anthropic, DeepSeek, OpenRouter, Pinecone, Supabase, Sentry, Honeycomb, Resend, Vercel, etc.) so we know what to top up before the demo. Research deliverable, not code.

7. **Demo-hygiene cleanup** (added 2026-05-24 from R3E findings):
   - Flip `FILE_DEBUG = true` → `false` in `src/app/results/page.tsx:45`.
   - Strip or `NODE_ENV === 'development'`-gate the `[E2E DEBUG]` console statements in `src/app/results/page.tsx`.
   - Gate the 10 `(debug)` routes in `src/middleware.ts`: 404 when `classifyHost() === 'public'`. Remove the `/editorTest` link from `AIEditorPanel.tsx`.

---

## Middleware Cookie-Write Spike — Resolved 2026-05-24

The R1C vs R4A dispute is settled by reading `src/lib/utils/supabase/middleware.ts` directly:

- The `setAll()` callback at lines 18-26 writes refreshed cookies onto a freshly-recreated `supabaseResponse`, which is returned at line 92.
- This is the mechanism `getUser()` (line 39) uses today to refresh access tokens on near-expiry — proven working, because if it didn't work the entire app would log users out at every token expiry.
- `signInWithPassword` invokes the same internal cookie-store write path and will fire the same `setAll()` callback.
- **Verdict: R1C correct, R4A wrong.** Lock the middleware approach. No POC needed — the existing token-refresh flow IS the proof of mechanism.

---

## High Level Summary

20 Explore agents across 4 rounds. The codebase is in good shape for the planned changes: most insertion points are greenfield (no conflicting code), and the Supabase SSR + Next.js middleware architecture aligns with the auto-login design. Critical surprises:

- **Two production-demo blockers discovered** that weren't in the original 6 requirements: `FILE_DEBUG = true` in `src/app/results/page.tsx:45` (verbose client console output), and 10 ungated debug routes under `src/app/(debug)/` reachable by URL-hacking on the public hostname.
- R1D agent **hallucinated** `MatchMode.StrictNew` for the seed script — actual force-new value is `MatchMode.SkipMatch`.
- R1C and R4A agents **disagreed** on whether `signInWithPassword` works from middleware (the load-bearing assumption for the entire guest-auto-login design). R1C is almost certainly right based on the existing `setAll()` cookie pattern, but a 30-min spike is warranted before locking the plan.
- **No `.env.prod.write` exists** — pre-demo prod seeding has no clean credential path; needs a manual `.env.local` swap or a one-shot admin endpoint.

---

## Key Findings (per requirement)

### Req 2 — Link bypass (Round 1A, Round 2A)

- **Single bypass point**: `src/lib/services/linkResolver.ts` lines 239-254, `resolveLinksForArticleImpl()`. Replace the `snapshot.data` source with a merged map of `(whitelist snapshot ∪ approved-status link_candidates with non-null standalone_title)`.
- **Call sites that matter**: `_resolveLinksForDisplayAction` (display path, the one we care about) and `_getLinkDataForLexicalOverlayAction` (editor overlay, INDEPENDENT — bypass won't affect it unless we also patch the overlay action).
- **Heading links are unaffected** — they come from `article_heading_links` table on a separate path, no whitelist gate.
- **Override semantics safe**: `article_link_overrides` is consulted at match time, AFTER the snapshot is built. Disabled overrides still suppress the term even when sourced from candidates.
- **No self-reference guard**: if Article A is titled "Machine Learning" and the words "Machine Learning" appear in its body, the resolver will link them to the article's own slug. Latent bug; bypass widens the surface but doesn't introduce it. Worth a follow-up.
- **Longest-first overlap prevention is robust** — adding more terms doesn't regress.
- No existing feature flag for bypass; we add a new one (env var preferred over hardcoded branch, so re-enable for non-demo envs is one flip).

### Req 3 — Status pill (Round 1B, Round 2B, Round 3B, Round 4C)

- **Reducer phases**: `idle → loading → streaming → viewing → editing → saving → error`. Pill subscribes to `phase` and shows:
  - `streaming` → State A
  - `viewing` (just transitioned from streaming) → State B for ~800ms
  - `viewing` (settled) → State C until dismiss/auto-timeout
  - `error` → must show an error variant (NEW state added — not in original spec)
  - `loading`, `saving`, `idle`, `editing` → hidden
- **SSE complete signal**: `event: complete` from `/api/returnExplanation/route.ts` line ~287. Triggers `LOAD_EXPLANATION` reducer action which transitions to `viewing`.
- **Mount point**: page root in `src/app/results/page.tsx` near line 1024 (`<div data-lifecycle-phase={...}>`). Render as sibling to main content, not inside the article container.
- **Coexists with the existing "Writing…" indicator** at `page.tsx:1397-1401` (which is content-placeholder, not status). UX question: do both show simultaneously? Recommend hiding the inline "Writing…" once the pill exists, since they convey the same info.
- **Cleanup hooks**: handle reducer `RESET` (page navigation / new query), `ERROR` (show error state, don't auto-dismiss), edit-mode-during-streaming (blocked at reducer level — no extra pill logic needed).
- **Reusable building blocks**: `.paper-texture`, `.shadow-warm-lg`, `rounded-full`, Tailwind keyframe `animate-fade-up`. z-index = `40` (Sonner top-right won't collide; sheets z-60, popovers z-50). Heroicons (`PencilSquareIcon`, `CheckCircleIcon`) preferred; both already imported in results page.
- **Layout confirms `→` arrow direction**: AIEditorPanel is a 360px right sidebar in `<main className="flex h-full">`. Right-arrow points correctly.
- **`useReducedMotion` hook does NOT exist** — use CSS `@media (prefers-reduced-motion: reduce)` directly in the pill component.

### Req 4 — Admin password rotation (Round 3D)

- **Known prod admin email**: `abecha@gmail.com` (per `/supabase/seed-admin.sql`).
- **Admin table**: `admin_users` with `user_id` FK to `auth.users` and `role` column (defaults `'admin'`).
- **Rotation procedure**: Supabase dashboard → Authentication → Users → Reset password. CLI alternative: `npx supabase auth admin update-user --email abecha@gmail.com --password <new>`.
- **MUST update in sync**: GitHub Production environment secrets `TEST_USER_PASSWORD` (used by `e2e-nightly.yml` at 6am UTC and `post-deploy-smoke.yml` after every prod deploy) — if rotated admin user is also the E2E test user, nightly tests will break the next morning.
- **No password is committed anywhere** — only env vars and Supabase Auth.
- `auditLog.ts` doesn't log password changes (sanitizes password/secret fields), so the audit trail won't pick this up unless we manually note it.

### Req 5 — Guest auto-login (Round 1C, Round 2C, Round 2D, Round 3A, Round 4A, Round 4D)

- **Insertion point**: `src/lib/utils/supabase/middleware.ts` line ~41-42, right after `const { data: { user } } = await supabase.auth.getUser()`.
- **The load-bearing assumption** (DISPUTE — see Open Questions): the existing `setAll()` cookie callback in `createServerClient` writes cookies onto `supabaseResponse` automatically when `signInWithPassword` triggers an internal cookie write. R1C says yes (and the pattern is correct per Supabase docs); R4A says no (claiming middleware can't modify the outgoing response of the current request — which is wrong: middleware *is* the outgoing response). Verify with a 30-min POC before locking.
- **Hostname gate**: `classifyHost()` returns one of `'local' | 'preview' | 'public' | 'evolution' | 'unknown'`. Auto-login YES on `local | preview | public`, NO on `evolution | unknown`. Fail-closed: `'unknown'` returns 404 before `updateSession()` even runs.
- **Middleware matcher already excludes static assets** (`/_next/static/*`, `/_next/image/*`, `/favicon.ico`, image extensions, `/api/health`, `/api/client-logs`, `/api/traces`, `/api/monitoring`, `/api/cron`) — no racing on JS/CSS bundle requests.
- **`/login` and `/auth/*` already exempt from redirect** in `updateSession()` — needs new logic: if guest session is active AND route is `/login`, redirect to `/`.
- **`/login` page is `'use client'`** — add a `useEffect` that calls `useUserAuth()` and redirects to `/` if `userid === GUEST_EMAIL`. Alternative: convert to server component and use `redirect()`. Client-side `useEffect` is the lower-risk choice for the demo.
- **Sign-out button location**: `src/components/Navigation.tsx` lines 170-180. Wrap in `{!isGuest && (...)}` gated by a new `useIsGuest()` hook added to `src/hooks/useUserAuth.ts`.
- **No other auth surfaces to hide** — no profile page, no change-password / delete-account flows, no OAuth or magic-link entry points. Settings page is theme-only and safe.
- **Admin escape hatch**: admins sign in via the evolution hostname `/login` (no auto-login fires there). Confirmed by middleware's existing host classification.
- **LLM cost cap** for the guest: hardcoded check in `src/lib/services/llms.ts` at `callLLMModelRaw()` (`if (userid === GUEST_ID && dailySpend > 10) throw GlobalBudgetExceededError`). The proper schema route (per-user `daily_cost_rollups` column + RPC change) is ~30 lines and overkill for v1; defer.
- **Seed script approach** (R3C, R4E):
  - Use `MatchMode.SkipMatch` (NOT `StrictNew` — that was hallucinated).
  - Pattern from `scripts/backfill-summaries.ts` + dynamic imports + service role client + `dotenv`.
  - Idempotency: skip seeding if guest's `userLibrary` already has ≥5 entries; `--force` flag to override.
  - **No prod-write credentials in repo** (`.env.prod.readonly` is read-only by design). Demo prep options: (a) developer temporarily puts prod service-role key in `.env.local` and runs from local machine, (b) build a one-shot admin endpoint we hit with a token. Option (a) is the conventional move; flag as a manual ops step.
  - Don't title-prefix seed content with `[DEMO]` — `filterTestContent` in `findMatches.ts` would hide them from search. Identify seeded content by guest's user_id instead.

### Req 6 — Paid-services inventory (Round 2E)

| Service | Purpose | Env var | Billing | Demo concern |
|---|---|---|---|---|
| **OpenAI** | LLM + embeddings | `OPENAI_API_KEY` | Per-token | **YES** — primary cost driver |
| **Anthropic** | Claude Sonnet 4 | `ANTHROPIC_API_KEY` | Per-token ($3-$75/1M) | YES — expensive if used |
| **DeepSeek** | LLM fallback | `DEEPSEEK_API_KEY` | Per-token ($0.28-$0.42/1M) | NO — cheap |
| **OpenRouter** | Qwen/Gemini/gpt-oss gateway | `OPENROUTER_API_KEY` | Per-token | MAYBE |
| **Pinecone** | Vector DB | `PINECONE_API_KEY` | Per-month + per-ops | YES — every save creates a vector |
| **Supabase** | DB + Auth | `SUPABASE_SERVICE_ROLE_KEY` | Freemium | NO |
| **Honeycomb** | Tracing/logs (OTEL) | `OTEL_EXPORTER_OTLP_*` | 20M events/month free | YES — `OTEL_SEND_ALL_LOG_LEVELS=false` in demo env |
| **Sentry** | Error tracking | `SENTRY_DSN` | 5K errors/month free | YES — verify quota before demo |
| **Resend** | Email (maintenance scheduler) | `RESEND_API_KEY` | Per-message | NO — not on demo path |
| **Vercel** | Hosting | (managed) | Per-bandwidth + per-function | NO — within free tier |

**Top-up before demo**: OpenAI primarily. Monitor Honeycomb + Sentry quotas. Set `OTEL_SEND_ALL_LOG_LEVELS=false` in the demo Vercel project.

---

## NEW Demo Blockers (not in original 6 requirements — surfaced by Round 3 audit)

These should be added to the plan as Requirement #7 (or folded into existing scope):

1. **`FILE_DEBUG = true` in `src/app/results/page.tsx:45`** — turns on verbose client-side `console.debug` logging visible in browser devtools. Demo viewers shouldn't see internal logs.
2. **`[E2E DEBUG]` console.log statements** in `src/app/results/page.tsx` (around `'Complete event received'`, `'Redirecting to'`). Strip or gate behind `NODE_ENV === 'development'`.
3. **10 ungated debug routes** under `src/app/(debug)/`: `/diffTest`, `/editorTest`, `/streaming-test`, `/latex-test`, `/mdASTdiff_demo`, `/resultsTest`, `/test-client-logging`, `/test-global-error`, `/tailwind-test`, `/typography-test`. All authenticated routes but show internal dev tooling. Mechanism: middleware-level 404 when `classifyHost() === 'public'`. Caveat: `/editorTest` is linked from `AIEditorPanel.tsx` and `/admin/dev-tools` — either remove the link or keep `/editorTest` whitelisted.

---

## Test Impact (Round 3A)

Tests we will break with the planned changes:

| File | Test | What breaks | Fix |
|---|---|---|---|
| `src/__tests__/e2e/specs/auth.unauth.spec.ts:23-28` | unauth user → redirect to `/login` | Auto-login serves content instead | Add `E2E_TEST_MODE` gate to middleware auto-login |
| `src/__tests__/e2e/specs/01-auth/auth.spec.ts:38-56` | sign-out clears session | Auto-login instantly re-signs-in | Same `E2E_TEST_MODE` gate |
| `src/middleware.test.ts:55-79` | hostname routing | Possible regression if auto-login fires before hostname gate | Verify hostname-gate runs first |
| `src/lib/services/llms.test.ts` | `checkBudget` mock | Doesn't account for guest hardcoded cap | Add a test case for `userId === GUEST_ID` |

Link-resolver, navigation, candidate tests don't break (they mock the gate).

**Required**: thread an `E2E_TEST_MODE` (or similar) escape hatch through the middleware auto-login block so the unauth specs still verify the unauth flow.

---

## Open Questions (for `/plan-review`)

1. **Verify middleware sign-in cookie-write** (R1C vs R4A) — 30-min spike: temporarily insert `signInWithPassword` in middleware, hit the page, inspect DevTools → Application → Cookies for `sb-access-token` / `sb-refresh-token`. If absent, fall back to server-action approach (slightly more redirect but proven pattern).
2. **Prod-write credentials story for seed script** — manual `.env.local` swap by developer, or build a one-shot admin endpoint? Affects ops checklist.
3. **`/editorTest` debug route** — is it actually linked from `AIEditorPanel.tsx` (R4B claim)? If yes, do we want to keep that link on the public site or remove it as part of the gating sweep?
4. **Public-site "Writing…" inline indicator** vs new pill — coexist or replace?
5. **NEW Requirement #7** — should the debug-route gating + `FILE_DEBUG` flag cleanup + console.log strip be a separate workstream, or folded into the existing scope?

---

## Documents Read

### docs_overall (8)
- getting_started.md, architecture.md, project_workflow.md, white_paper.md, design_style_guide.md, environments.md, debugging.md, testing_overview.md, cloud_env.md, managing_claude_settings.md, instructions_for_updating.md

### feature_deep_dives (25, all)
- search_generation_pipeline.md (primary)
- add_sources_citations.md (primary)
- error_handling.md (primary)
- authentication_rls.md (primary)
- realtime_streaming.md (primary)
- admin_panel.md, ai_suggestions_overview.md, debugging_skill.md, explanation_summaries.md, iterative_planning_agent.md, lexical_editor_plugins.md, link_whitelist_system.md, maintenance_skills.md, manage_sources.md, markdown_ast_diffing.md, metrics_analytics.md, request_tracing_observability.md, server_action_patterns.md, state_management.md, tag_system.md, testing_pipeline.md, testing_setup.md, user_testing.md, vector_search_embedding.md, writing_pipeline.md

### evolution/docs (all, for context — not directly relevant to this project)
- All 20+ evolution docs read at /initialize.

---

## Code Files Read (via Explore agents)

### Link resolution
- `src/lib/services/linkResolver.ts` — bypass point at lines 239-254
- `src/lib/services/linkWhitelist.ts` — `getActiveWhitelistAsMap`, snapshot mechanism
- `src/lib/services/linkCandidates.ts` — candidate approval flow
- `src/actions/actions.ts` — `_resolveLinksForDisplayAction`, `_getLinkDataForLexicalOverlayAction`
- Schema: `article_link_overrides`, `link_candidates`, `link_whitelist`, `link_whitelist_snapshot`, `article_heading_links`

### Streaming + lifecycle
- `src/reducers/pageLifecycleReducer.ts` — full phase map + actions
- `src/hooks/useStreamingEditor.ts` — streaming state hook
- `src/hooks/useExplanationLoader.ts` — data load orchestration
- `src/app/api/returnExplanation/route.ts` — SSE event emission (`event: complete`, `event: error`)
- `src/app/results/page.tsx` — page layout, `FILE_DEBUG=true` flag, inline "Writing…" indicator, lifecycle dispatch wiring

### Auth + middleware
- `src/middleware.ts` — `config.matcher`, hostname gating, exempt routes
- `src/lib/utils/supabase/middleware.ts` — `updateSession`, `createServerClient` cookies callback
- `src/lib/utils/supabase/server.ts` — server-component supabase client
- `src/app/login/actions.ts` — `login()`, `signOut()` patterns
- `src/app/login/page.tsx` — client-side login form
- `src/config/hostnames.ts` — `classifyHost()` matrix
- `src/components/Navigation.tsx` — sign-out button location (lines 170-180)
- `src/app/settings/SettingsContent.tsx` — theme-only, safe
- `src/hooks/useUserAuth.ts` — user-info hook (add `useIsGuest()` here)
- `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` — post-auth handlers, no change needed

### LLM cost gate
- `src/lib/services/llmSpendingGate.ts` — global caps only, no per-user
- `src/lib/services/llms.ts` — `callLLMModelRaw`, `checkBudget` call site
- `supabase/migrations/*_add_llm_cost_security.sql`, `*_daily_cost_rollups.sql` — schema
- `llm_cost_config` table — single-row JSONB config; no per-user dimension

### Seed script + pipeline reuse
- `src/lib/services/returnExplanation.ts` — `returnExplanationLogic()`, callable from script
- `src/lib/services/userLibrary*.ts` — `saveExplanationToLibrary(explanationid, userid)`
- `scripts/backfill-summaries.ts` — script template (dotenv, service role client, dynamic imports)
- `scripts/seed-admin-test-user.ts` — admin user seeding pattern
- `src/lib/schemas/schemas.ts` — `MatchMode` enum (actual values: `Normal`, `ForceMatch`, `SkipMatch`)

### Admin + audit
- `supabase/migrations/20260115080637_create_admin_users.sql` — `admin_users` schema
- `supabase/seed-admin.sql` — seed pattern
- `src/lib/services/adminAuth.ts` — `isUserAdmin`, `requireAdmin` (with hostname assertion)
- `src/lib/services/auditLog.ts` — sanitizes password fields

### Tests
- `src/__tests__/e2e/specs/auth.unauth.spec.ts`, `01-auth/auth.spec.ts`
- `src/middleware.test.ts`
- `src/lib/services/llms.test.ts`, `linkResolver.test.ts`, `linkWhitelist.test.ts`, `linkCandidates.test.ts`
- `src/components/Navigation.test.tsx`

### Debug routes + production hygiene
- `src/app/(debug)/*/page.tsx` — 10 debug route handlers
- `src/components/AIEditorPanel.tsx` — link to `/editorTest`
- `src/app/admin/dev-tools/page.tsx` — admin link to debug routes
