# Build Website for Evolution Plan

## Background
Help me build a user facing website for evolution.

## Requirements (from GH Issue #1293)
Build a front-end and stop experimenting.

- Choose a good URL.
- User can paste in any article.
- It can run a pipeline using a set strategy that is selectable via the UI.
- Can see final output, and a diff against the initial input side-by-side. Following the existing pattern on variant details tab for diff against parent.

## Problem
The evolution pipeline has no user-facing surface — every entry point (admin UI, `/api/evolution/run`, batch runner, local script) is admin-gated. There is no way for an unprivileged visitor to paste in an article, pick a strategy, run it, and see the improved output side-by-side with the original. The hypothesis: a public-facing website fronting the pipeline turns evolution from an experiment into a product, exposing whether the quality gains are useful to real readers/writers rather than just measurable on the leaderboard.

While building this surface, the existing `LLMSpendingGate.checkPerUserCap` mechanism has known gaps that became material once user-controlled spend is in scope: fail-open behavior on DB errors, no reserve-before-spend semantics, a magic-number `10` at the call site. Those gaps are addressed in Phase 0 of this same PR so the public surface ships on top of a hardened gate.

## Decisions Locked (see _research.md for trade-off analysis)

| # | Decision | Detail |
|---|---|---|
| 1 | Hosting | Option A — path `/edit` on `explainanything.vercel.app` (existing public host). Add `/edit` to `PUBLIC_PREFIXES` in `src/config/hostnames.ts`. |
| 2 | URL path | `/edit` |
| 3 | Execution | Async via existing minicomputer queue (`processRunQueue.ts`, 60s poll). POST inserts a `pending` `evolution_runs` row, returns `runId`; client polls until `status='completed'`. |
| 4 | Strategy whitelist | New `public_visible BOOLEAN` column on `evolution_strategies` (default `false`). Editable from admin UI inline on strategy list page + on strategy detail page. New `listPublicStrategiesAction` for `/edit` picker. |
| 5 | Rate-limit infra | Upstash Redis KV. Per-IP daily $ spending cap ($0.50/day default) + per-region daily $ spending cap ($5/day default per country), both via `INCRBYFLOAT` with 24h TTL. Layers on top of hardened per-user + global gates. |
| 6 | Per-run cap | `evolution_runs.budget_cap_usd = $0.10` for /edit submissions. Strategy whitelist eligibility predicate: `strategy.config.budgetUsd <= $0.10`. |
| 7 | Auth | Fully unauthed. `callLLM` receives `process.env.GUEST_USER_ID` as `userid` (shares the existing guest pool — no custom sentinel; this corrects the iter-1 draft that proposed a separate sentinel which would have silently bypassed the per-user gate). No middleware change to guest auto-login — `/edit` simply doesn't depend on it. Run-result viewing via `/edit/runs/{runId}` URL (UUID is unguessable; results contain visitor's own text). |
| 8 | Admin gap | Fix `queueEvolutionRunAction` to validate `explanationId` against `explanations` table (currently only validates `promptId`). Share the validator with the new public-side insert helper. |
| 9 | Picker UX | Name + short description only on the strategy picker. No cost/runtime preview. Curate display names to hint at trade-offs. |
| 10 | Retention | Keep forever. No UI for deletion. Privacy note in page footer ("Your text + the result are saved so we can improve the system. Don't paste anything sensitive."). |
| Scope | Single PR | Includes Phase 0 gate hardening (gaps 1, 2, 3, 5 from research). |

## Phased Execution Plan

### Phase 0: Harden the LLMSpendingGate (precondition)
The new public surface depends on a fail-CLOSED, reserve-before-spend gate. Land these fixes first within the PR so subsequent phases build on a correct foundation.

**Rollout sequencing (load-bearing — addresses cold-start outage risk).** The new behavior MUST default OFF on the first deploy so a transient cold-start (migration applies after code goes live, or RPC missing in a region) does not brick every LLM-using surface. Concrete sequence:

1. Phase 0 lands with `LLM_GATE_FAIL_CLOSED_DISABLED='true'` set in BOTH staging + Production Vercel envs at merge time. New code is no-op-equivalent to old behavior at startup.
2. CI's `migration-verify` step + the supabase-migrations.yml deploy ensures the new RPC + config keys land in the database before traffic.
3. After 24h staging soak + post-deploy smoke green, flip `LLM_GATE_FAIL_CLOSED_DISABLED='false'` in staging via Vercel UI (no redeploy). Watch Honeycomb for `gate.fail_closed_rejected` for another 24h.
4. Flip the same env var to `'false'` on Production. The single env-var flip is a 30-second rollback if anything fires.
5. After one full release cycle clean, delete the kill-switch + the deprecated `checkPerUserCap` wrapper in a follow-up PR.

- [ ] **Gap 1 — fail-CLOSED**: replace the 3 silent-return sites in `src/lib/services/llmSpendingGate.ts:117-124, 143-147` with explicit `throw new GlobalBudgetExceededError(...)`. Tag thrown errors with `cause: 'gate_check_failed'` so Honeycomb can distinguish from real over-cap rejections. Gated by `LLM_GATE_FAIL_CLOSED_DISABLED !== 'true'` — when the kill switch is set, retain today's silent-return behavior (one-line `if (process.env.LLM_GATE_FAIL_CLOSED_DISABLED === 'true') return;` at each site).
- [ ] Add `LLM_GATE_PANIC_BYPASS` env var (mirror of `SEED_BYPASS_USER_CAP`). When `'true'`, all gate checks short-circuit; logs an audit line to stderr per call. NEVER set in any deployed env by default. Document in `docs/docs_overall/environments.md`.
- [ ] **Gap 5 — configurable cap**: add `guest_user_daily_cap_usd`, `public_edit_per_ip_daily_usd`, `public_edit_per_region_daily_usd`, `public_edit_daily_cap_usd` keys to `llm_cost_config` table. Default values: $10, $0.50, $5, $15. Add `getPublicEditConfig()` helper using the existing config-read pattern (see `checkMonthlyCap` at `llmSpendingGate.ts:364`).
- [ ] Replace the hard-coded `10` at `src/lib/services/llms.ts:988` with the config-driven value. Keep the existing `userid === GUEST_USER_ID` gating predicate (only fires for the demo guest; admins skip — unchanged).
- [ ] **Gap 2+3 — reserve-before-spend** for the per-user gate:
  - [ ] **Separate `per_user_reservations` table** (iter-3 architecture fix — addresses call_source-scoping mismatch). Earlier draft added `reserved_usd` as a sibling column on `per_user_daily_cost_rollups`, but that table's PK is `(date, user_id, call_source)` and the trigger writes rows per-call_source — so a reservation keyed on `call_source='public_edit'` would never be offset when actual LLM calls land on `call_source='evolution_<agent>'` rows. The reservation, the trigger write, and the cap-check were three different scopings. Fix: store reservations in a **new dedicated table** keyed on `(date, user_id)` only:
    ```sql
    CREATE TABLE IF NOT EXISTS per_user_daily_reservations (
      date DATE NOT NULL,
      user_id TEXT NOT NULL,
      reserved_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, user_id)
    );
    -- Partial index for orphan-cleanup's WHERE clause (predicate-aligned)
    CREATE INDEX IF NOT EXISTS idx_per_user_reservations_stale
      ON per_user_daily_reservations (updated_at)
      WHERE reserved_usd > 0;
    -- deny-all RLS + service_role bypass, same pattern as 20260524000003
    ```
  - [ ] New migration `<timestamp>_reserve_per_user_daily_cost_rpc.sql`: `reserve_per_user_daily_cost(p_user_id TEXT, p_date DATE, p_estimated_usd NUMERIC, p_cap_usd NUMERIC) RETURNS jsonb` RPC, modeled on `check_and_reserve_llm_budget` at `supabase/migrations/20260228000001_add_llm_cost_security.sql:84-117` (verified). **Atomic check-then-increment via `SELECT … FOR UPDATE`** — UPSERT-with-RETURNING cannot reject after-the-fact, so concurrent callers at cap boundary would silently over-cap.
    ```sql
    -- 1. Ensure reservation row exists, then lock it
    INSERT INTO per_user_daily_reservations (date, user_id, reserved_usd)
      VALUES (p_date, p_user_id, 0)
      ON CONFLICT (date, user_id) DO NOTHING;
    SELECT reserved_usd INTO v_reserved
      FROM per_user_daily_reservations
      WHERE date = p_date AND user_id = p_user_id
      FOR UPDATE;
    -- 2. SUM total_cost_usd across ALL call_sources for (user, date) — matches existing checkPerUserCap read pattern
    SELECT COALESCE(SUM(total_cost_usd), 0) INTO v_total
      FROM per_user_daily_cost_rollups
      WHERE date = p_date AND user_id = p_user_id;
    -- 3. Reject if (existing total + outstanding reservations + this estimate) > cap
    IF v_total + v_reserved + p_estimated_usd > p_cap_usd THEN
      RETURN jsonb_build_object('ok', false, 'dailyTotal', v_total + v_reserved, 'dailyCap', p_cap_usd);
    END IF;
    -- 4. Increment reservation
    UPDATE per_user_daily_reservations
      SET reserved_usd = reserved_usd + p_estimated_usd, updated_at = now()
      WHERE date = p_date AND user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'reservedUsd', p_estimated_usd, 'dailyTotal', v_total + v_reserved + p_estimated_usd, 'dailyCap', p_cap_usd);
    ```
  - [ ] **Reconciliation lives ONLY at app-side `recordActualForUser` / `releaseForUser`** (iter-3 fix: drop the trigger-side reservation update entirely — earlier draft had both the trigger AND app-side decrement, producing double-decrement). `recordActualForUser(userid, actualCents, reservedCents)` calls a new `reconcile_per_user_reservation(p_user_id, p_date, p_reserved_usd) RETURNS void` RPC that `UPDATE per_user_daily_reservations SET reserved_usd = GREATEST(0, reserved_usd - p_reserved_usd)` (the `GREATEST(0, ...)` floor prevents negative reservations from race conditions). The existing `update_per_user_daily_cost_rollup()` trigger continues to write to `per_user_daily_cost_rollups.total_cost_usd` unchanged — so actual spend lands on the per-call_source row, reconciliation lands on the per-user reservation row, and the cap-check sums both. The two tables stay independent + correctly composed. **Idempotency-lint compliance:** `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `CREATE TABLE IF NOT EXISTS`. Validate locally with `npm run lint:migrations`.
  - [ ] Add `reserveForUser(userid, estCost, capUsd)`, `recordActualForUser(userid, actualCents, reservedCents)`, `releaseForUser(userid, reservedCents)` to `LLMSpendingGate`. Mirror existing `reserveViaRpc` / `reconcileAfterCall` pattern at `llmSpendingGate.ts:178-220`.
  - [ ] Replace `checkPerUserCap` call site in `src/lib/services/llms.ts:988` with `reserveForUser`; wire reconcile into the existing `finally` block at `llms.ts:1008`. **Reconciliation invariant:** on synchronous throw, request abort, container kill mid-call, or `reconcileAfterCall.catch()` swallow, reservation is RELEASED via `try/finally` — never silently abandoned. Failure to reconcile invalidates the user-spending cache so the next call gets a fresh DB read; documented in code comment.
  - [ ] Keep `checkPerUserCap` as deprecated read-only wrapper for one release cycle to ease rollback. Add ESLint rule `no-restricted-imports` blocking new callers, pointing to `reserveForUser` instead. Rule lives in `.eslintrc.json` (project-wide) and matches the existing `no-restricted-imports` pattern. Removed in the same follow-up PR that drops the kill switch.
  - [ ] New migration `<timestamp>_per_user_reservation_cleanup.sql`: `cleanup_orphaned_per_user_reservations(p_stale_minutes INT DEFAULT 15) RETURNS INT` RPC. Releases by `UPDATE per_user_daily_reservations SET reserved_usd = 0, updated_at = now() WHERE updated_at < now() - (p_stale_minutes || ' minutes')::interval AND reserved_usd > 0`. Returns count of rows released. Targets the dedicated `per_user_daily_reservations` table created above.
  - [ ] **Scheduling** (iter-3 fix: explicit lifecycle + on-boot guarantee). Call `cleanup_orphaned_per_user_reservations(15)` from `processRunQueue.ts` **once at BOOT, BEFORE the `while (processedRuns < MAX_RUNS)` loop** — guarantees one cleanup per systemd-timer firing (~60s cadence) even when the queue is empty and the runner exits immediately at `processRunQueue.ts:222-224` ("No pending runs found, exiting"). Placing it INSIDE the loop would mean cleanup never fires on empty-queue invocations. Document the runner-timer cadence + the on-boot placement in `evolution/docs/minicomputer_deployment.md`. ~5 LoC change.
- [ ] Honeycomb alerts (TWO distinct event names so ops can prioritize):
  - `gate.fail_closed_rejected` — gate-check itself failed (Supabase blip, missing RPC, RLS misconfig). HIGH priority — implies system-broken-not-user-fault. Fields: `{category, userid, errorType, cause: 'gate_check_failed'}`.
  - `gate.guest_pool_exhausted` — legitimate over-cap rejection where `category='per_user' AND userid===GUEST_USER_ID AND total>=cap`. INFORMATIONAL — the cap is doing its job; only alert if rate sustained (e.g. >5 events/hour signals starvation between /edit and guest-autologin traffic, triggering the "follow-up per-/edit-only cap" decision).
  Extend `.github/workflows/evolution-run-health.yml` to file a `[release-health]` issue when EITHER event count > 0 over 1 hour (mirrors the nightly-failure alerting pattern). **Owner: engineering** (this PR includes the YAML edit). Honeycomb-dashboard side (saved queries + visual alerts) is ops-owned — track in `_progress.md` as a manual post-merge step.
- [ ] Add `LLM_GATE_FAIL_CLOSED_DISABLED` env var as kill-switch reverting to fail-open behavior; **default `'true'` on this PR's merge** (so the new behavior is OFF at first), flipped to `'false'` after the staged-rollout soak per the sequencing above.

### Phase 1: Backend plumbing
- [ ] **Admin gap** (Q8): in `evolution/src/services/evolutionActions.ts:178-189` (admin `queueEvolutionRunAction`), add symmetric `explanationId` validation against the `explanations` table — currently only `promptId` is validated. Extract to shared validator `validateRunContentRefs({explanationId?, promptId?}, supabase)` in `evolution/src/services/shared.ts` and reuse from both admin path and new public action. Returns typed error matching admin convention.
- [ ] **`publicAction` factory** (NEW, load-bearing): add `evolution/src/services/publicAction.ts` — mirror of `adminAction.ts` but WITHOUT `requireAdmin()`. Wraps handler with `withLogging` + `serverReadRequestId` + a service-role Supabase client (since unauthed callers have no user session). Returns the same `ActionResult<T>` envelope. All three new unauthed actions below use this factory.
- [ ] **Strategy whitelist column** (Q4): migration adds `evolution_strategies.public_visible BOOLEAN NOT NULL DEFAULT false`. Add `idx_strategies_public_visible` partial index `WHERE public_visible = true AND status = 'active'` (composite to match `listPublicStrategiesAction` filter). Idempotency: `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- [ ] Extend `updateStrategyAction` in **`evolution/src/services/strategyRegistryActions.ts`** (file is NOT `V2` — corrected from earlier draft) to accept `publicVisible` field. Server-side guard reads the existing row first to access `config` JSONB → parses `StrategyConfig` → asserts `config.budgetUsd <= 0.10` before allowing `public_visible=true`. Refusal returns `{success:false, error:{code:'PUBLIC_VISIBLE_BUDGET_TOO_HIGH', message, budgetUsd, cap}}` so the admin UI can render a specific tooltip. **On successful `publicVisible` change:** invalidate the `listPublicStrategiesAction` module-scope cache by calling its `invalidate()` helper (~3 LoC export on the cache helper). Admin sees the change reflected on `/edit` immediately within the current serverless instance; cross-instance staleness is bounded by the 60s TTL and documented as accepted.
- [ ] New `publicAction`-wrapped `listPublicStrategiesAction` in `evolution/src/services/strategyRegistryActions.ts`. Returns only `{id, label, description, generationModel, judgeModel, iterationCount}` for rows with `public_visible=true AND status='active' AND is_test_content=false`. Cache 60s in-memory (module-scope Map keyed `'all'` with `Date.now()` expiry).
- [ ] **Upstash gate** (Q5): new module `src/lib/services/perIpSpendingGate.ts`. Exports `reserveForIp(ip, estCost)`, `recordActualForIp(ip, actualCents, reservedCents)`, `releaseForIp(ip, reservedCents)`, plus equivalent `*ForRegion(country, ...)` family. Uses `@upstash/redis` `incrbyfloat` + `expire 86400`. **Fail-CLOSED on KV error** (consistent with Phase 0 contract) — set the `@upstash/redis` retry option to 0 and throw `PerIpBudgetExceededError` on any non-200; the existing `LLM_GATE_FAIL_CLOSED_DISABLED` env var ALSO disables this gate's fail-closed for the rollout window. **Eager-reservation contract:** per-IP / per-region reservations are NOT auto-released when a downstream per-user / global cap rejects the LLM call mid-run. This is intentional — over-projection is the defense — and the max-leak-per-failed-run is bounded by `evolution_runs.budget_cap_usd` ($0.10). Documented in `evolution/docs/cost_optimization.md`.
- [ ] **Test-mode bypass for the per-IP/per-region gate**: when `process.env.E2E_TEST_MODE === 'true'` OR `process.env.PUBLIC_EDIT_RATE_LIMIT_DISABLED === 'true'`, the gate short-circuits and `reserveForIp` returns the estimate without consulting Upstash. CI E2E + nightly + integration tests all share one egress IP and would otherwise trip the cap mid-suite. Documented in environments.md.
- [ ] **`getClientGeo` helper**: `getClientGeo(request: NextRequest): {ip: string, country: string}`. **Implementation reads headers directly** (Next.js 15 removed `NextRequest.ip` + `.geo` — iter-2 fix): `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()` for IP (Vercel-set), `request.headers.get('x-vercel-ip-country')` for country (Vercel-set). **Trust assertion:** the helper requires `request.headers.get('x-vercel-id')` to be present (Vercel emits this on every prod request). When absent (off-Vercel route, attacker-crafted request bypassing the edge), returns `{ip: 'unknown', country: 'unknown'}` so the per-IP cap collapses to a single shared bucket — defense in depth against forged `x-forwarded-for`. For tests, the helper honors `x-test-client-ip` + `x-test-client-country` ONLY when `process.env.NODE_ENV === 'test'`. Unit test asserts the trust assertion + bypass paths.
- [ ] **Bot protection — Vercel BotID** (iter-3 rewrite per real API verified at https://vercel.com/docs/botid/get-started):
  - [ ] **Package: `botid`** (NOT `@vercel/botid` — earlier draft was wrong). `npm install botid`.
  - [ ] **`next.config.ts` wrapper:** import `withBotId` from `botid/next/config` and wrap the exported config: `export default withBotId(nextConfig)`. This sets up proxy rewrites against ad-blocker domains — without it, BotID's challenge endpoint is trivially blocked by uBlock/etc. and the feature degrades silently.
  - [ ] **Client init via `instrumentation-client.ts`** (Next.js 15.3+ pattern): create `/instrumentation-client.ts` at the **project root** (not under `src/`) — Next.js requires this file to sit alongside the existing `/instrumentation.ts` (verified: this project's existing server-side `instrumentation.ts` is at repo root, NOT `src/`). Call `initBotId({ protect: [{ path: '/edit', method: 'POST' }] })` from `botid/client/core`. Auto-attaches challenge token to matching requests; no React hook needed.
  - [ ] **Server side:** `submitPublicEditAction` first line is `const verdict = await checkBotId();` from `botid/server` (NO `request` argument — `checkBotId()` reads context from the active request). On `verdict.isBot === true`, return 403 with copy "Submission blocked. If you're a human and seeing this in error, try again."
  - [ ] **Vercel dashboard:** enable BotID for the project (Project Settings → BotID → toggle ON). One-time ops setup; document as post-merge step in `_progress.md`.
  - [ ] **Test/local bypass:** new env var `BOT_PROTECTION_DISABLED='true'` short-circuits the server check (mirrors `PUBLIC_EDIT_RATE_LIMIT_DISABLED` pattern). Set in `playwright.config.ts` webServer block + integration test setup + local `.env.local`. Without it, E2E + integration + local dev would always 403 because BotID only runs on Vercel infra.
  - [ ] **`playwright.config.ts` test-mode contract:** the `BOT_PROTECTION_DISABLED='true'` env var is set globally for the E2E suite. A code comment at the env-set site documents this contract: "All E2E tests run with BotID disabled. A future test that needs to exercise the real BotID path must spawn its own webServer with the var unset, or invoke checkBotId directly in a unit test." Mirror in `docs/docs_overall/environments.md` env-var table.
  - [ ] E2E: `edit-flow.spec.ts` asserts the happy path works WITH `BOT_PROTECTION_DISABLED='true'`. A separate UNIT test `submitPublicEditAction.test.ts` confirms the server check fires when `BOT_PROTECTION_DISABLED` is NOT set + `checkBotId` mock returns `{isBot: true}` → 403.
  - [ ] Why required: a residential-proxy bot ($1/IP) trivially exhausts the per-IP $0.50/day cap by rotating IPs; per-region $5/day caps fall to coordinated regional attacks; BotID is the only defense layer that distinguishes "human visitor" from "automated requester" at scale.
- [ ] **New action `submitPublicEditAction`** (`publicAction`-wrapped): POST handler. Steps:
  1. `const verdict = await checkBotId();` from `botid/server` (NO request arg) → if `verdict.isBot === true`, return 403
  2. Validate input: `{articleText: 1-50000 chars, strategyId: uuid}` via Zod
  3. Validate strategy via `listPublicStrategiesAction`; refuse if not public-visible (404)
  4. `getClientGeo(request)` → `{ip, country}`
  5. `estRunCost = projectDispatchPlan(strategy.config, ...).expected` (use the projector's `expected`, not `upperBound` — fairness matters more than over-rejection at the submission boundary)
  6. Pre-submission affordability check (Gap 4): refuse with 429 if `estRunCost > min(remainingUserBudget, remainingIpBudget, remainingRegionBudget)`. Returns `Retry-After` derived from earliest cap reset. **TOCTOU note:** accepted — max overage is one per-run cap ($0.10) per concurrent submit; the per-call gate at `callLLM` is the airtight backstop.
  7. Reserve $est against per-IP + per-region gates (eager, not reconciled at this layer — over-projection is intentional for defense)
  8. **Create a topic for this submission via `createTopic({topic_title: '[EDIT] <first 60 chars>...'})`** (matches `src/actions/importActions.ts:119-127` pattern — `processImport` creates a topic per import row). Returns BIGINT `topic_id`. Topic title carries the `[EDIT]` prefix so admin tools can filter.
  9. **Insert into the existing `explanations` table** with the SCHEMA-VERIFIED payload (verified against `src/lib/database.types.ts:1714-1735`): `{ explanation_title: '[EDIT] <first 80 chars>...', content: articleText, primary_topic_id: <BIGINT from step 8>, status: 'draft', source: 'public_edit' }`. **Schema notes:** `primary_topic_id BIGINT NOT NULL FK→topics` is required (no default — earlier draft missed this); `status` must be `'draft'` or `'published'` per CHECK constraint (earlier draft's `'private'` would fail); `explanation_text_type` does NOT exist as a column — the actual nullable provenance field is `source: string | null` (earlier draft was wrong). Returns BIGINT `id`.
  10. Insert `evolution_runs` row: `{explanation_id: <BIGINT from step 9>, strategy_id, budget_cap_usd: 0.10, run_source: 'public_edit', status: 'pending'}`. **Note:** `evolution_runs.evolution_explanation_id` does NOT exist — the only seed-text FK is `explanation_id BIGINT` (migration `20260409000002`).
  11. Return `{runId}`
- [ ] **New `evolution_runs.run_source TEXT NOT NULL DEFAULT 'admin'` column.** Migration `<timestamp>_add_evolution_runs_run_source.sql`. Add CHECK constraint `run_source IN ('admin','minicomputer','public_edit','test','local')`. Backfill via same migration (iter-2 fix: dropped bogus `mini-%` prefix that exists nowhere, added correct `local` branch):
  ```sql
  -- minicomputer-issued runner IDs follow the pattern `v2-<hostname>-<pid>-<ts>` (verified at processRunQueue.ts:57)
  UPDATE evolution_runs SET run_source = 'minicomputer' WHERE runner_id LIKE 'v2-%';
  -- admin "Trigger Run" / API route IDs follow `api-<uuid>` (verified at src/app/api/evolution/run/route.ts:57)
  UPDATE evolution_runs SET run_source = 'admin' WHERE runner_id LIKE 'api-%';
  -- run-evolution-local.ts inserts runs WITHOUT setting runner_id; backfill these by `runner_id IS NULL`
  UPDATE evolution_runs SET run_source = 'local' WHERE runner_id IS NULL;
  -- everything else stays at the DEFAULT 'admin' (mostly historical experiment runs)
  ```
  All NEW insert sites must explicitly set the column. NOT NULL DEFAULT means test fixtures that miss the column still pass (auto-set to `'admin'`) — acceptable for v1 but means the cost-dashboard per-source split will mis-attribute test fixture runs as admin runs (minor accepted cost).
- [ ] **`run_source` insert-site audit (load-bearing — addresses agent finding).** Update EVERY existing insert into `evolution_runs` to explicitly set `run_source`:
  - [ ] `evolution/src/services/evolutionActions.ts:queueEvolutionRunAction` → `'admin'`
  - [ ] `evolution/src/services/experimentActionsV2.ts:addRunToExperimentAction` → `'admin'` (the admin "Add run" path in the experiment wizard)
  - [ ] `evolution/src/lib/pipeline/manageExperiments.ts:addRunToExperiment` → `'admin'`
  - [ ] `evolution/scripts/run-evolution-local.ts` insert at lines 223-230 → `'local'`
  - [ ] `evolution/scripts/debugLineageChain.ts`, `debugLineageChain2.ts` → `'local'` (if they insert)
  - [ ] Test fixtures: `src/__tests__/e2e/helpers/evolution-test-data-factory.ts:createTestRun` and integration fixtures → `'test'`
  - [ ] Grep audit at PR time: `grep -rn "from('evolution_runs')" --include='*.ts' --include='*.tsx'` should return zero un-annotated inserts. Add to PR checklist.
- [ ] **`[EDIT]` discovery-filter extension** (load-bearing — addresses iter-2 architecture finding). The existing `[TEST]` prefix filter lives at THREE sites (verified by grep). All three must be extended to also exclude `[EDIT]`:
  - [ ] `src/lib/services/explanations.ts` — extend `TEST_CONTENT_PREFIX` constant or add a sibling `PUBLIC_EDIT_PREFIX = '[EDIT]'` constant, then update the `.not('explanation_title', 'ilike', ...)` filters at lines 174-175 + 209-210
  - [ ] `src/lib/services/findMatches.ts` — same: extend the `TEST_CONTENT_PREFIX`-based vector-search post-filter at lines 15, 39
  - [ ] `src/lib/services/adminContent.ts:99` — currently a hard-coded `'%[TEST]%'` literal; extend to also exclude `'%[EDIT]%'`. Admin can opt back in via a UI filter ("Show /edit submissions") if needed; default-off matches the `[TEST]` pattern.
  - [ ] Unit test in `explanations.test.ts` asserts `[EDIT]`-titled rows are excluded from `getExplanations`, `findSimilarExplanations`, and admin content list. Without this test, a future refactor could silently re-expose /edit content in Explore.
- [ ] **`evolution_topics`-vs-`topics` consideration:** the topic created at step 8 lands in the main-app `topics` table (the same table used by all `explanations`). This means /edit submissions create one new topic each — same as `processImport` does today. Topics with `[EDIT]` prefix are NOT linked back to the public Explore (the discovery filter above hides them), but they DO accumulate in the `topics` table. For v1 this is acceptable (storage cost of a topic row is trivial); a follow-up could either (a) re-use a single sentinel topic with `topic_title='[EDIT] Public submissions'` (saves rows; loses per-submission metadata) or (b) add a `topics.source` column + filter the admin topics list. Both are deferrals; document in `evolution/docs/data_model.md`.
- [ ] **New action `getEditRunStatusAction({runId})`** (`publicAction`-wrapped): Returns `{status, winnerVariantContent?, originalContent, errorMessage?, costSpent, etaSeconds?}`. Used by /edit results page polling. Looks up the run row + winning variant if `status='completed'`. No ownership check — anyone with the run-id UUID can read. Adds `Cache-Control: private, no-store` + `Referrer-Policy: no-referrer` response headers (defense-in-depth against URL leak to third parties via referrer / browser-history sync).
- [ ] **Per-user gate wiring — `userid = GUEST_USER_ID` not a custom sentinel (load-bearing — fixes silent-bypass bug).** Earlier draft used `'public_edit_anonymous'` sentinel, but `src/lib/services/llms.ts:986-989` only invokes the per-user cap when `userid === process.env.GUEST_USER_ID` — a custom sentinel would silently SKIP the cap. Fix: `submitPublicEditAction` passes `process.env.GUEST_USER_ID` as `userid` to `callLLM` for every LLM call in the run (via the existing claim/execute path). **Trade-off:** /edit traffic now shares the same $10/day pool as existing public-site guest auto-login traffic. One demo viewer doing a `searchExplanation` could starve a /edit user (or vice versa). Accepted for v1 because: (a) the trade-off matches the research-doc Q7 framing ("all guest visitors collectively share one $10/day pool"), (b) layered Upstash per-IP/per-region caps provide fairer per-actor limits, (c) splitting the pool requires a new `llm_cost_config` key + a new condition in `llms.ts:986-989` — straightforward follow-up if the shared-pool starvation actually surfaces. The `llmCallTracking` trigger and `per_user_daily_cost_rollups` table already handle the GUEST_USER_ID correctly. **NO sentinel introduced.**

### Phase 2: Frontend
- [ ] Page route: `src/app/edit/page.tsx`. **Server component** (matches existing public-site pattern at `src/app/page.tsx`). Server-side fetches strategies via `listPublicStrategiesAction()` and passes the result as initial props to the client child — avoids loading flash + one extra round-trip. Two subcomponents:
  - `<EditForm initialStrategies={...}/>` (client): textarea + strategy radio cards + Submit button. Owns the form state + `editPageLifecycleReducer`. Submits via `submitPublicEditAction` (Next.js server-action), then `router.push('/edit/runs/' + runId)`.
  - Privacy footer (Q10): "Your text + the result are saved. Don't paste anything sensitive."
- [ ] Page route: `src/app/edit/runs/[runId]/page.tsx`. Server component. **Polling pattern (explicit choice, SSE deferred):** client child uses `setInterval` to call `getEditRunStatusAction(runId)` every 3s while `status ∈ {pending, claimed, running}`. Hard timeout at 10 minutes (200 polls) — past that, renders the error state with "this is taking longer than expected." SSE upgrade is a follow-up: would replace the polling loop with a `EventSource` connected to a new `/api/edit/runs/[runId]/stream` route that watches `evolution_runs` via Supabase Realtime row subscription. SSE deferred because (a) Polling MVP is ~30 LoC vs SSE's ~120 LoC, (b) polling gives identical UX at this cadence (3s perceived as real-time), (c) most runs complete in under 60s = ~20 polls. Document the upgrade path in a code comment so a future contributor knows to make the swap if poll volume becomes a Vercel function-invocation cost concern.
- [ ] **Run-result page response headers** (defense-in-depth against URL leak to third parties): page sets `<meta name="robots" content="noindex,nofollow">` + `Referrer-Policy: no-referrer` + `Cache-Control: private, no-store` via Next.js `generateMetadata` + route-level headers. UUID URLs are unguessable, but browser history sync to Google/iCloud + URL-shortener caches + share-sheet integrations would otherwise persist the URL beyond the visitor's session. (Plan dismissed one-time tokens at Q7 — these headers + UUID unpredictability are the alternative.)
- [ ] Render the diff via `<SideBySideWordDiff parent={originalContent} variant={winnerVariantContent} leftLabel="Your text" rightLabel="Evolved" />` once `status='completed'`. Component wrapper named `PublicEditDiffPanel` to keep the public-edit surface clearly distinct from the admin `VariantParentDiffTab`.
- [ ] Page state machine: new `editPageLifecycleReducer`. States: `idle → submitting → queued → running → viewing → error`. **Rationale for a new reducer** (not extending `pageLifecycleReducer`): the existing reducer carries `streaming/editing/saving` phases tied to the explanation lifecycle. /edit has `queued/running` (queue-and-poll model) which doesn't fit those phases. A separate small reducer is clearer than overloading the existing one. Selectors mirror existing convention (`isQueued`, `isRunning`, `getError`, etc.).
- [ ] **Queue starvation note** (load-bearing — addresses async-queue agent finding). The minicomputer's `processRunQueue.ts` claims runs in FIFO order with `PARALLEL=1` by default. A burst of /edit traffic could block admin runs / experiments behind the queue. **Accepted for v1**, with two mitigations: (a) Document the risk in `evolution/docs/minicomputer_deployment.md`. (b) Add a Honeycomb dashboard query for "queue depth by run_source" so ops can spot starvation. (c) Operational lever: ops can bump `--parallel 3` on the minicomputer systemd unit when /edit traffic warrants. Follow-up project would split into priority lanes (admin runs claim ahead of `run_source='public_edit'`) — out of scope for this PR but documented.
- [ ] **Middleware allowlist** (Q1): add `/edit` to `PUBLIC_PREFIXES` in `src/config/hostnames.ts:49-58`. Add a unit test in `src/middleware.test.ts` that hits the public host with path `/edit` and expects pass-through, hits the evolution host with `/edit` and expects 404.

### Phase 3: Admin UI for `public_visible`
- [ ] Strategy list page `src/app/admin/evolution/strategies/page.tsx`: add `Public visible` column with an inline toggle (`Checkbox` component). Toggle calls `updateStrategyAction({id, publicVisible})`. Disable toggle when `config.budgetUsd > 0.10` (read locally from the row's `config` JSONB the list page already fetches — `parseStrategyConfig(row.config).budgetUsd`) with tooltip "Per-run budget exceeds $0.10 public cap". **Optimistic UI flow:** toggle flips immediately in local state → server action fires → on success, no-op; on failure, revert local state + render a Toast (`sonner`) with the structured error's message (e.g. `PUBLIC_VISIBLE_BUDGET_TOO_HIGH` → "This strategy's per-run budget exceeds the $0.10 public cap. Lower the budget first or unset publicly visible."). The server-side guard reads + parses `config` independently (defense-in-depth against stale client-side read).
- [ ] Strategy detail page `src/app/admin/evolution/strategies/[strategyId]/page.tsx` (route param is `[strategyId]`, NOT `[id]` — corrected from earlier draft, verified against existing route structure at `src/app/admin/evolution/strategies/[strategyId]/`): add the same toggle in the strategy header card. Reuses the list-page toggle component.
- [ ] List page filter chip "Public only" alongside the existing status/hide-test-content filters.
- [ ] Column is sortable; data-testids `strategy-public-visible-toggle` + `strategy-public-visible-cell` for E2E.

### Phase 4: Cost / safety polish
- [ ] **`attributeCallSource` update** (load-bearing — addresses testing-agent finding). Add `'evolution_public_edit'` (or whatever final call_source string is chosen) to `CALL_SOURCES` in `src/lib/services/llmCallSource.ts` AND to `ENTITY_BY_SOURCE` in `src/lib/services/llmCostAttribution.ts`. Without this, the cost dashboard groups public-edit spend under "unknown" and the exhaustiveness test fails CI.
- [ ] **Surface `run_source='public_edit'` filter** in `/admin/costs` dashboard so ops can monitor public-edit spend separately. Reuse existing `getCostByEntityAction` pattern. Add a dedicated tile for "Public /edit (7-day)" showing `SUM(cost_usd) WHERE run_source='public_edit'`.
- [ ] **Sentry `beforeSend` adjustments:** (a) add `surface=edit` tag when path matches `/edit*` for finer triage than the existing `site=public|evolution|preview|local|unknown` tag; (b) **strip user-pasted text from breadcrumbs + tags** — concrete predicate matches Sentry's actual breadcrumb shape (verified): for every `breadcrumb.data.body` (string) AND every `breadcrumb.data.response_body_size` (when paired with `category === 'xhr' || 'fetch'`), if the body string-includes `'articleText'` (the field name in our POST payload), the entire `data.body` is replaced with `'[redacted: edit submission body]'`. Same predicate applies to `event.request.data` for server-side errors. Tag values matching `articleText` literally are unlikely (Sentry doesn't auto-tag body content) but the `beforeSend` also iterates `event.tags` and clears any value > 500 chars defensively. Defense against the user pasting an API key / password / PII into the textarea and Sentry capturing it on an unrelated error.
- [ ] **Honeycomb spans:** confirm `'evolution_public_edit'` cost-source flows through the existing `evolution_*` tracing path (it does by prefix match). Add a dashboard saved query for `service_name=evolution AND call_source LIKE 'evolution_public_edit%'`.
- [ ] **Privacy note + opt-out** (Q10): add a Markdown line at the bottom of `/edit` and `/edit/runs/[runId]`. Link to a privacy section in the main site footer. **GDPR / right-to-erasure note:** since `/edit` is unauthed and retention is keep-forever (Q10), there's no UI for the visitor to delete their data. Plan accepts this for v1 — document a "data-deletion request" support email + the SQL to satisfy it in `evolution/docs/architecture.md` so ops can handle requests manually.
- [ ] **Cleanup gate compatibility:** ensure the existing `claim_evolution_run` test-content gate (`allow_test_execution=false` by default) lets `run_source='public_edit'` rows through. The gate keys on the **strategy's** `is_test_content` (NOT on run_source) — so as long as Phase 3's server-side guard refuses `public_visible=true` on test strategies (which it does), public-edit runs are claim-eligible by default. (Earlier draft wording was misleading and has been clarified.)
- [ ] **`PUBLIC_EDIT_DISABLED` kill switch** (NEW). New env var. When `'true'`, `submitPublicEditAction` returns `503 Service Unavailable` with copy "Public /edit is temporarily disabled. Try again later." Allows ops to turn off the public surface without a code revert when a separate axis breaks (e.g. Upstash outage, OpenRouter quota dry, abuse spike). Documented in `docs/docs_overall/environments.md`. The `/edit` page also reads this env var server-side and renders a "Temporarily unavailable" page instead of the form.
- [ ] **CI path classifier update** (load-bearing — iter-3 made explicit). Two distinct edits to `.github/workflows/ci.yml`:
  1. Add `src/lib/services/perIpSpendingGate|src/__tests__/e2e/specs/12-edit/` to the `EVOLUTION_ONLY_PATHS` regex (these are evolution-specific concerns).
  2. Add `src/app/edit/` to the **SHARED_PATHS** regex (force full-run on any /edit page changes — covers `e2e-non-evolution` middleware/host-isolation jobs that matter for /edit). NOT to `EVOLUTION_ONLY_PATHS` — that would skip non-evolution coverage.
  3. NOT `src/lib/services/llmSpendingGate` (already matched by SHARED_PATHS — would be dead-code addition).
  Verify the regex compiles + matches the new paths via a one-line CI test.

## Testing

### Test Environment & Secrets (load-bearing — addresses testing-agent findings)

- [ ] **GitHub Environment secrets to provision** (NEW). Document + add via Repo Settings → Environments:
  - **Staging environment** (used by `ci.yml` + `e2e-nightly.yml` + integration tests): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` pointing to a dedicated Upstash dev database.
  - **Production environment** (used by `post-deploy-smoke.yml`): same two secrets pointing to the prod Upstash database.
  - **Repository secrets** (shared): none — Upstash is per-environment.
  - Update the table in `docs/docs_overall/environments.md` lines 290-410.
- [ ] **Test-mode bypass for per-IP gate** (NEW): `perIpSpendingGate.ts` checks `process.env.E2E_TEST_MODE === 'true'` OR `process.env.PUBLIC_EDIT_RATE_LIMIT_DISABLED === 'true'` and returns a no-op `reserveForIp`. CI E2E + nightly + integration tests all share one egress IP and would otherwise trip the cap mid-suite. Also: `getClientGeo` honors `x-test-client-ip` header ONLY when `NODE_ENV === 'test'` (unit + integration tests can supply unique synthetic IPs).
- [ ] **Seeded E2E strategy** (iter-2 simplified — carve-out removed; the seed strategy passes filters naturally). E2E spec `edit-flow.spec.ts` needs a strategy that is simultaneously (a) `public_visible=true`, (b) NOT auto-filtered by `claim_evolution_run` test-content gate, (c) cheap enough to mock. Solution: add a seeded `Public Edit Smoke` strategy via `evolution/scripts/seedPublicEditE2EStrategy.ts` with: `name='Public Edit Smoke'` (deliberately does NOT match `[E2E]`/`[TEST]`/`[TEST_EVO]` so the `evolution_is_test_name` trigger leaves `is_test_content=false`), `budgetUsd=$0.001`, `public_visible=true`, model `'mock'` (E2E uses route-mocked LLM so the model field is decorative). **No carve-out needed in `updateStrategyAction`** — the strategy passes the existing `public_visible_budget_too_high` guard ($0.001 < $0.10), the existing `is_test_content=false` filter, and the `listPublicStrategiesAction` filter. (Iter-2 fix: the original `[E2E_EVO]` carve-out logic was redundant; removed.) Documented in `evolution/docs/cost_optimization.md` "Test cost containment" section. Idempotent seed: `ON CONFLICT (config_hash) DO NOTHING` so re-running the script is safe.

### Unit Tests
- [ ] `src/lib/services/llmSpendingGate.test.ts` — extend existing tests:
  - Fail-closed behavior: all 3 error sites throw `GlobalBudgetExceededError` with `cause: 'gate_check_failed'` when `LLM_GATE_FAIL_CLOSED_DISABLED !== 'true'`
  - Fail-closed-DISABLED (kill switch): when `LLM_GATE_FAIL_CLOSED_DISABLED === 'true'`, all 3 error sites silent-return (today's behavior). **Critical:** rollback path must work on Day 1.
  - `LLM_GATE_PANIC_BYPASS='true'` short-circuits the entire gate; logs stderr audit line.
  - Reserve-before-spend cycle: `reserveForUser` → simulated success → `recordActualForUser` reconciles; `reserveForUser` → simulated failure → `releaseForUser` frees.
  - Concurrent reservation reference pattern: reuse the same scaffolding as `src/__tests__/integration/evolution-budget-constraint.integration.test.ts` (existing pattern for the global gate).
  - Configurable cap reads from `llm_cost_config` keys (mocked DB read).
- [ ] `src/lib/services/perIpSpendingGate.test.ts` (NEW) — testability via a `KvAdapter` interface injected at construction:
  - In-memory test adapter (Map-backed) for unit tests — no Upstash dependency at unit-test level
  - `reserveForIp` returns reservation, exceeds cap throws `PerIpBudgetExceededError`, TTL respected, `recordActualForIp` reconciles, `releaseForIp` frees
  - **Upstash unreachable test:** mock adapter returns rejection → expect throw (fail-CLOSED on KV error). Mock adapter returns rejection AND `LLM_GATE_FAIL_CLOSED_DISABLED='true'` → expect silent-allow (kill-switch path)
  - `getClientGeo` falls back to `'unknown'` outside Vercel; honors `x-test-client-ip` only when `NODE_ENV === 'test'`
  - `E2E_TEST_MODE='true'` AND `PUBLIC_EDIT_RATE_LIMIT_DISABLED='true'` both trigger no-op path
- [ ] **`src/lib/services/llmCostAttribution.test.ts`** (extend existing) — assert `'evolution_public_edit'` is in `CALL_SOURCES` and `ENTITY_BY_SOURCE`; exhaustiveness test passes.
- [ ] **`src/__tests__/integration/per-user-orphan-cleanup.integration.test.ts`** (NEW) — time-bound behavior of the `cleanup_orphaned_per_user_reservations(p_stale_minutes)` RPC: seed a row with `reserved_usd=5.00, updated_at=now()-INTERVAL '20 minutes'` + another with `reserved_usd=3.00, updated_at=now()-INTERVAL '5 minutes'` → call cleanup with `p_stale_minutes=15` → assert only the first row is released to `reserved_usd=0`, second untouched. Also assert the RPC returns the count of rows released.
- [ ] **`src/lib/services/sentry-edit-redact.test.ts`** (NEW) — `beforeSend` hook strips `articleText`-shaped values from breadcrumbs + tags. Test cases: (a) breadcrumb with `data.body.articleText='secret'` → field stripped from outgoing payload; (b) tag value matching the article content → tag cleared; (c) unrelated breadcrumbs pass through unchanged.
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` (corrected from `*V2*` to `strategyRegistryActions.test.ts`) — `listPublicStrategiesAction` filters correctly (only `public_visible=true AND status='active' AND is_test_content=false`); `updateStrategyAction` refuses `publicVisible=true` when `budgetUsd > 0.10` AND returns the structured error code `PUBLIC_VISIBLE_BUDGET_TOO_HIGH`. No carve-out logic (the seeded smoke strategy passes naturally — see Phase 1 seed bullet).
- [ ] `evolution/src/services/evolutionActions.test.ts` — admin-path `validateRunContentRefs` rejects unknown `explanationId` (Q8 gap fix). Shared validator returns the same error envelope across admin + public paths.
- [ ] `evolution/src/services/publicAction.test.ts` (NEW) — `publicAction` factory wraps handlers with `withLogging` + `serverReadRequestId` + service-role Supabase client; rejects callers attempting to pass admin-only fields.
- [ ] `src/app/edit/submitPublicEditAction.test.ts` (NEW) — happy path returns `{runId}`; non-public-visible strategy → 404; `articleText > 50000 chars` → 400; missing `BotID` token → 403; `PUBLIC_EDIT_DISABLED='true'` → 503; concurrent affordability-check race (TOCTOU bound: max one extra run per concurrent submit).
- [ ] `src/app/edit/getEditRunStatusAction.test.ts` (NEW) — correct shape across pending/claimed/running/completed/failed/cancelled states; response headers include `Cache-Control: private, no-store` + `Referrer-Policy: no-referrer`.
- [ ] `src/reducers/editPageLifecycleReducer.test.ts` (NEW) — state-machine transitions for idle → submitting → queued → running → viewing → error; selectors return correct values per state.
- [ ] `src/middleware.test.ts` (extend) — `/edit` pass-through on public host, 404 on evolution host; `/edit/runs/<uuid>` same.
- [ ] **`src/lib/services/explanations.test.ts`** (extend existing) — assert `[EDIT]`-titled rows are excluded from `getExplanations` + `findSimilarExplanations` + admin content list (the 3 sites updated in Phase 1). Lock-in test: protects against a future refactor silently re-exposing `/edit` content.

### Integration Tests
- [ ] `src/__tests__/integration/public-edit.integration.test.ts` (NEW) — end-to-end against staging DB with mocked LLM:
  - Submit using the seeded `Public Edit Smoke` strategy via `submitPublicEditAction`
  - Verify `topics` row created with `[EDIT]` prefix + `explanations` row created with `[EDIT]` prefix + `evolution_runs` row created with `run_source='public_edit'`
  - Trigger `claimAndExecuteRun` directly (bypassing minicomputer)
  - Verify run completes, winner variant exists
  - `getEditRunStatusAction` returns the winner's content
  - `afterAll` cleanup: delete the `evolution_runs` + `explanations` rows
- [ ] `src/__tests__/integration/llm-spending-gate-hardened.integration.test.ts` (NEW):
  - **Fail-closed:** simulate missing RPC (rename in test) → expect `GlobalBudgetExceededError`, NOT silent allow
  - **Cold-start path:** `LLM_GATE_FAIL_CLOSED_DISABLED='true'` AND missing RPC → expect silent-allow (rollback path works)
  - **Reserve-before-spend:** seed rollup at $9.50/cap → 50 parallel `reserveForUser` calls → only the first to cross $10 succeeds, rest reject. Reuse the scaffolding pattern from `evolution-budget-constraint.integration.test.ts`.
  - **Orphan cleanup:** simulate a reservation that never reconciles → `cleanup_orphaned_per_user_reservations()` releases it.
- [ ] `src/__tests__/integration/per-ip-gate.integration.test.ts` (NEW) — same shape against real Upstash (gated on `UPSTASH_REDIS_REST_URL` being present; silent-skip otherwise). Reserve, reconcile, release; concurrent N callers at cap-boundary.
- [ ] `src/__tests__/integration/strategy-public-visible.integration.test.ts` (NEW) — admin toggles `public_visible`; verify `listPublicStrategiesAction` reflects; cost-cap guard rejects toggling on a $0.20-budget strategy; seeded `Public Edit Smoke` strategy ($0.001 budget) toggles successfully + appears in `listPublicStrategiesAction` results; lock-in assertion that seeded strategy's `budgetUsd = 0.001` (catches future config drift).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/12-edit/edit-form-smoke.spec.ts` (NEW, **`@critical`** + **`@skip-prod`** tagged) — fast smoke (~5s): visit `/edit`, assert form testids visible (`edit-form`, `strategy-picker`, `submit-button`), no console errors. NO submission — pure SSR smoke that catches deployment breakage without burning real $.
- [ ] `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` (NEW, **`@evolution`** + **`@skip-prod`** tagged; downgraded from `@critical` per testing-agent finding — full happy path is ~30s with mocked SSE which is too long for the <3min `@critical` target). Playwright happy path:
  - Visit `/edit` on public host
  - See strategy picker populated (seeded `Public Edit Smoke` strategy)
  - Paste sample text + pick strategy + Submit
  - Mock the run to complete in 1s (`E2E_TEST_MODE=true` triggers an in-process executor that skips minicomputer)
  - Land on `/edit/runs/[runId]`
  - Assert `SideBySideWordDiff` renders with original on left, evolved on right (testids `sxs-diff`, `sxs-parent`, `sxs-variant`)
  - Assert response headers include `noindex` + `no-referrer`
  - Assert privacy footer present
  - `afterAll` cleanup: delete created rows (enforced by ESLint `flakiness/require-test-cleanup`)
- [ ] `src/__tests__/e2e/specs/12-edit/edit-host-isolation.spec.ts` (NEW, `@critical`) — `/edit` returns 200 on `explainanything.vercel.app`, 404 on `ea-evolution.vercel.app`. Extends `00-host-isolation/host-isolation.spec.ts`.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-public-toggle.spec.ts` (NEW, `@evolution`) — admin can flip the `public_visible` toggle inline on the strategy list page; toggle disabled for strategies with `budgetUsd > 0.10`; failed-toggle revert + toast.
- [ ] `src/__tests__/e2e/specs/smoke.public.spec.ts` (extend, `@smoke-public`) — add assertions:
  - `/edit` returns 200 + form renders (catches Vercel deployment breakage without a real submission)
  - The response includes the `x-vercel-id` header (lock-in for the trust assertion `getClientGeo` makes against forged `x-forwarded-for` — if Vercel ever changes the header name, this smoke catches it before /edit's per-IP cap silently collapses to a single 'unknown' bucket).
  Matches the existing matrix `--grep="@smoke-public"` in `post-deploy-smoke.yml`.

### Manual Verification
- [ ] Local server + Playwright MCP: paste a 500-word article, pick a strategy, observe the diff renders matching the variant-details tab visual exactly (same fonts, same gutter, same color encoding).
- [ ] Local: with `PUBLIC_EDIT_RATE_LIMIT_DISABLED` UNSET, trip the per-IP cap by submitting 6 runs from the same dev session → expect 429 on the 6th.
- [ ] Local: set `LLM_GATE_FAIL_CLOSED_DISABLED='true'` → confirm gate reverts to silent-allow behavior (rollback path works).
- [ ] Local: set `PUBLIC_EDIT_DISABLED='true'` → confirm form shows "temporarily unavailable" + POST returns 503.
- [ ] Staging: enable `public_visible` on 2-3 curated strategies via the admin UI; manually verify they appear in the `/edit` picker.
- [ ] Staging: paste a real article + run a real strategy; confirm the minicomputer picks it up within ~60s and the result polls in.
- [ ] Staging: after Phase 0 fail-closed flag flip, watch Honeycomb for `gate.fail_closed_rejected` events for 24h.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` — full happy path on local dev server (managed via `ensure-server.sh`)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/edit-host-isolation.spec.ts` — host gating works
- [ ] Visual check against `/admin/evolution/variants/[variantId]?tab=parent-diff` — same component, same look

### B) Automated Tests
- [ ] `npm test -- src/lib/services/llmSpendingGate.test.ts` — fail-closed + reserve-before-spend
- [ ] `npm test -- src/lib/services/perIpSpendingGate.test.ts` — Upstash gate
- [ ] `npm test -- src/app/edit/` — server actions + reducer
- [ ] `npm run test:integration -- --testPathPattern="public-edit"` — full integration
- [ ] `npm run test:integration -- --testPathPattern="llm-spending-gate-hardened"` — gate hardening
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/` — E2E suite
- [ ] `npm run migration:verify` — confirms new migrations apply cleanly (Phase 0 + Phase 1)

## Documentation Updates
- [ ] **NEW** `docs/feature_deep_dives/llm_spending_gate.md` — dedicated deep dive on the hardened gate: layered cap stack (per-run / per-IP / per-region / per-user / global / kill-switch), reserve-before-spend semantics, fail-closed contract + kill-switch rollback path, orphan-reservation cleanup cron, `LLM_GATE_PANIC_BYPASS` + `LLM_GATE_FAIL_CLOSED_DISABLED` + `PUBLIC_EDIT_RATE_LIMIT_DISABLED` + `PUBLIC_EDIT_DISABLED` env vars + the panic-bypass audit-log pattern. Cross-links from `evolution/docs/cost_optimization.md`.
- [ ] `docs/feature_deep_dives/authentication_rls.md` — add `/edit` to the public-host route table; note the unauthed pattern (uses `GUEST_USER_ID` as `callLLM` userid, NOT a separate sentinel — clarified); document the `LLM_GATE_PANIC_BYPASS` + `LLM_GATE_FAIL_CLOSED_DISABLED` kill switches (link to llm_spending_gate.md).
- [ ] `docs/feature_deep_dives/server_action_patterns.md` — add `submitPublicEditAction`, `getEditRunStatusAction`, `listPublicStrategiesAction` to the action catalog. Document the new `publicAction` factory pattern alongside the existing `adminAction`.
- [ ] `docs/feature_deep_dives/state_management.md` — add `editPageLifecycleReducer` next to the existing reducer documentation; explain why a separate reducer was chosen.
- [ ] `docs/docs_overall/design_style_guide.md` — likely unchanged (reusing existing components); confirm no new variant introduced during execution.
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — note that `/edit` reuses `SideBySideWordDiff` without modification.
- [ ] `docs/docs_overall/environments.md` — add `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` to the env-var reference table; add `PUBLIC_EDIT_DISABLED`, `PUBLIC_EDIT_RATE_LIMIT_DISABLED`, `LLM_GATE_PANIC_BYPASS`, `LLM_GATE_FAIL_CLOSED_DISABLED`; note Upstash add-on provisioning in the Vercel section + GH Environment secret tables.
- [ ] `evolution/docs/architecture.md` — add `submitPublicEditAction → claimAndExecuteRun` as a fifth entry point alongside the existing four. Document the `run_source` column + values; document GDPR/data-deletion request handling.
- [ ] `evolution/docs/data_model.md` — document `evolution_runs.run_source` + `evolution_strategies.public_visible` columns. Note the new `per_user_daily_cost_rollups` reservation semantics (clarify the read-only `checkPerUserCap` vs reserve-before-spend `reserveForUser`). Correct any stale `evolution_runs.evolution_explanation_id` references — that column does NOT exist; the seed-text FK is `explanation_id BIGINT`.
- [ ] `evolution/docs/strategies_and_experiments.md` — document the public-strategy whitelist mechanism + the admin UI toggle + the seeded `Public Edit Smoke` strategy used by the E2E suite.
- [ ] `evolution/docs/visualization.md` — cross-link the new `/edit` public surface from the admin strategy list section; note the `Public visible` column.
- [ ] `evolution/docs/cost_optimization.md` — document the layered cap stack for public-edit (per-run / per-IP / per-region / per-user / global); document the new `llm_cost_config` keys + their defaults; extend the "Test cost containment" section with the `PUBLIC_EDIT_RATE_LIMIT_DISABLED` + `BOT_PROTECTION_DISABLED` test-mode env vars and the seeded `Public Edit Smoke` strategy.
- [ ] `evolution/docs/minicomputer_deployment.md` — document the queue-starvation risk under /edit traffic burst + ops lever (`--parallel 3`); priority-lane follow-up TBD.
- [ ] `evolution/docs/reference.md` — add new files (`perIpSpendingGate.ts`, `submitPublicEditAction`, `publicAction.ts`, etc.) + new env vars to the env-var catalog.
- [ ] `evolution/docs/reference.md` — add new files (`perIpSpendingGate.ts`, `submitPublicEditAction`, etc.) + new env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LLM_GATE_PANIC_BYPASS`, `LLM_GATE_FAIL_CLOSED_DISABLED`).
- [ ] `docs/docs_overall/environments.md` — add `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` to the env-var reference table; note Upstash add-on provisioning in the Vercel section.
- [ ] (Other relevantDocs from `_status.json` are read for context but unlikely to require updates; verify during /finalize.)

## UI Mockups

Four key states for the `/edit` flow. All styling uses existing primitives — see "Design system alignment" below for exact class mappings.

### 1. `/edit` — idle (paste form)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │   ← <Navigation showSearchBar={false}/>
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         ┊  Edit anything.  ┊                                 │   ← atlas-display-section
│                                                                              │
│           Paste an article. Pick how it should be improved.                  │   ← atlas-ui muted
│           We'll rewrite it and show you exactly what changed.                │
│                                                                              │
│   ┌── How should we improve it? ─────────────────────────────────────────┐   │
│   │  ◉  Quick polish                                                     │   │   ← scholar-card,
│   │     Tighten wording. Improve sentence flow. No new content.          │   │     gold border on selected
│   │                                                                      │   │
│   │  ○  Deep refine                                                      │   │
│   │     Strengthen structure, add clarifying examples, polish tone.      │   │
│   │                                                                      │   │
│   │  ○  Make it punchier                                                 │   │
│   │     Cut redundancy. Sharper sentences. Same ideas, less prose.       │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌── Your text ─────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   Paste anything here. An article, an essay, a draft email…         │   │   ← atlas-body, rounded-none,
│   │                                                                      │   │     search-focus-glow
│   │                                                                      │   │     (mirrors HomeSearchPanel)
│   │                                                       1,247 / 50,000 │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│                              ┌───────────────────┐                           │
│                              │     Improve →     │                           │   ← atlas-button
│                              └───────────────────┘                           │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────      │
│   Your text and the result are saved so we can improve the system.           │   ← atlas-body text-muted
│   Don't paste anything sensitive.                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2. `/edit/runs/[runId]` — queued / running

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│                              ✦  ✦  ✦                                         │   ← quill-write animation
│                                                                              │
│                       Rewriting your text…                                   │   ← atlas-display-section
│                                                                              │
│                    Quick polish · 0:42 elapsed                               │   ← atlas-ui muted
│                                                                              │
│       This usually takes one to three minutes. We'll show the result          │
│       here when it's ready — you can keep this tab open or come back          │
│       to this URL later.                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Status text cycles by poll response:
- `status=pending` → "Queued… (~30s until pickup)"
- `status=claimed` → "Starting up…"
- `status=running` → "Rewriting your text…"

### 3. `/edit/runs/[runId]` — viewing the diff

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│   ╭──── Quick polish · finished in 1m 24s ────────────────────────────╮     │   ← scholar-card,
│   ╰────────────────────────────────────────────────────────────────────╯     │     paper-texture
│                                                                              │
│   ┌── Your text ──────────────────┐  ┌── Evolved ───────────────────────┐    │   ← SideBySideWordDiff
│   │                               │  │                                  │    │     (reused verbatim;
│   │  Quantum entanglement is one  │  │  Quantum entanglement, one of    │    │      leftLabel / rightLabel
│   │  of the strangest phenomena   │  │  the strangest phenomena in      │    │      overridden to
│   │  in physics. When two particles│  │  physics, occurs when two       │    │      "Your text" /
│   │  become entangled, measuring  │  │  particles become entangled —    │    │      "Evolved")
│   │  one of them instantly affects│  │  measuring one instantly         │    │
│   │  the other, no matter ̶h̶o̶w̶ ̶f̶a̶r̶ │  │  affects the other, regardless  │    │   ← removed words struck red
│   │  ̶a̶p̶a̶r̶t̶ ̶t̶h̶e̶y̶ ̶a̶r̶e̶.             │  │  of distance.                    │    │     on left, added green on
│   │                               │  │                                  │    │     right (identical to the
│   │  Einstein famously called this│  │  Einstein famously called this   │    │     variant-details "Diff vs
│   │  "spooky action at a distance,│  │  "spooky action at a distance,"  │    │     parent" tab)
│   │  ̶a̶ ̶t̶e̶r̶m̶ ̶t̶h̶a̶t̶ ̶s̶t̶u̶c̶k̶."        │  │  and the name stuck.             │    │
│   │  …                            │  │  …                               │    │
│   └───────────────────────────────┘  └──────────────────────────────────┘    │
│                                                                              │
│                                ▼ Show full                                   │   ← sxs-expand-toggle
│                                                                              │
│        ┌─────────────────┐    ┌─────────────────┐                            │
│        │  Try a different│    │  Edit something │                            │
│        │     style       │    │      else       │                            │
│        └─────────────────┘    └─────────────────┘                            │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────      │
│   Your text and the result are saved so we can improve the system.           │
│   Don't paste anything sensitive.                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

"Try a different style" → `/edit` with original text pre-filled + strategy reset, so users can swap strategies cheaply without re-pasting.

### 4. `/edit/runs/[runId]` — error

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│                              ⚠                                                │   ← text-copper
│                                                                              │
│                    Something went wrong.                                     │   ← atlas-display-section
│                                                                              │
│       The rewrite hit a snag part-way through. Your text wasn't              │   ← atlas-body
│       saved past this attempt — try again with the same or a different       │
│       style.                                                                 │
│                                                                              │
│                              ┌───────────────────┐                           │
│                              │     Try again →   │                           │   ← atlas-button
│                              └───────────────────┘                           │
│                                                                              │
│        Reference: run_a8c2f4e1                                               │   ← atlas-ui text-xs
│                                                                              │     (click-to-copy)
└──────────────────────────────────────────────────────────────────────────────┘
```

Internal failure codes (`BudgetExceededError`, `LLMKillSwitchError`, etc.) all map to the same non-technical copy. The `run_id` reference is the support hook back to logs.

## Design System Alignment

Verified against `src/app/page.tsx` + `src/components/home/HomeSearchPanel.tsx` to confirm `/edit` uses the **same primitives the public site uses today**, not the newer shadcn / `font-display` patterns from the design-style-guide quick reference. The guide explicitly endorses this: *"Use `atlas-display` for hero/landing pages and `atlas-display-section` for section pages (Settings, Explore, My Library) to maintain visual hierarchy."* `/edit` is a section page.

| `/edit` element | Class / Component (matches public-site convention) |
|---|---|
| Page shell | `min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture` |
| Top nav | `<Navigation showSearchBar={false} />` (existing, no changes) |
| Container | `container mx-auto px-8 max-w-2xl` (matches home) |
| H1 ("Edit anything") | `atlas-display-section text-[var(--text-primary)]` + `atlas-animate-fade-up stagger-1` |
| Subtitle | `atlas-ui text-[var(--text-muted)] tracking-wide` + `stagger-2` |
| Strategy radio cards | `.scholar-card` + `.scholar-card-hover`; selected = `border-gold`; titles in `atlas-ui`, descriptions in `atlas-body text-[var(--text-muted)]` |
| Textarea | `bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] atlas-body rounded-none search-focus-glow px-6 py-4` (mirrors `HomeSearchPanel:116`) |
| Char count | `atlas-ui text-xs text-[var(--text-muted)]` |
| Submit button | `atlas-button` (matches `HomeSearchPanel:126`) — NOT the new shadcn `<Button variant="scholar">`, because the public site hasn't migrated and consistency matters more |
| Submit loading | `atlas-loading-dots` + 3× `atlas-loading-dot` (matches `HomeSearchPanel:128-133`) |
| Privacy footer | `atlas-body text-sm text-[var(--text-muted)]` with `border-t border-[var(--border-default)]` divider |
| Results header card | `.scholar-card paper-texture rounded-book shadow-warm-md` |
| `SideBySideWordDiff` | unchanged; component-internal styling already correct |
| Loading animation | `quill-write` keyframe (existing) |
| Error glyph | `text-copper` |
| Card entrance | `atlas-animate-fade-up stagger-1/2/3` for sequential reveal |

**ESLint compatibility:** every class above is on the project's atlas / scholar / design-token allowlist. The custom rules in `eslint-rules/design-system.js` (`no-hardcoded-colors`, `prefer-warm-shadows`, `enforce-prose-font`, etc.) all pass on this mapping. No design-system-rule exceptions needed for `/edit`.

**Visual consistency check:** the `/edit` page, when loaded next to `/` (Home), `/results`, `/userlibrary`, should feel like the same product surface — same fonts, same warm cream, same paper texture, same nav. The atlas-class binding is what guarantees that.

## Review & Discussion

### Iteration 1 — Security 2/5, Architecture 2/5, Testing 2/5

**15 critical gaps surfaced + resolved:**

Security & Technical
1. Fail-CLOSED blast radius / cold-start ordering → staged rollout: kill-switch defaults `'true'` on merge, flipped after 24h staging soak; sequence documented in Phase 0
2. Per-IP cap easily bypassed (residential proxies + missing bot protection) → Vercel BotID integration added to Phase 1 + Upstash fail-CLOSED on KV error specified + `request.ip` trust documented via `x-vercel-id` assertion
3. Reserve-before-spend correctness / orphan cleanup → cited existing `check_and_reserve_llm_budget` RPC for lock semantics + added `cleanup_orphaned_per_user_reservations` RPC + reconciliation invariant on synchronous-throw + reservation-on-failure release
4. Migration deploy ordering → explicit deploy sequence in Phase 0 rollout block (migrations land first via supabase-migrations.yml, kill-switch keeps code no-op until verified)
5. `run_source` NULL + missed insert sites → added `NOT NULL DEFAULT 'admin'` + CHECK constraint + backfill migration + explicit 6-site insert audit list (was hand-wavy "set at every site")

Architecture & Integration
1. **`evolution_runs.evolution_explanation_id` does not exist** (insert payload was wrong) → corrected to use `explanations.id BIGINT` (the real seed-text FK from migration `20260409000002`); `evolution_explanations` write removed entirely (wrong table); `[EDIT]` title prefix added to the `explanations` insert for discovery-filter compatibility
2. File path `strategyRegistryActionsV2.ts` → corrected to `strategyRegistryActions.ts` (no V2 suffix) everywhere
3. `publicAction` wrapper pattern undefined → new `evolution/src/services/publicAction.ts` factory specified, mirrors `adminAction` minus `requireAdmin()`; reused across 3 unauthed actions
4. `'public_edit_anonymous'` sentinel silently bypassed the per-user cap → eliminated the sentinel; `submitPublicEditAction` now passes `process.env.GUEST_USER_ID` as `userid` so the existing `llms.ts:986-989` gate predicate fires correctly
5. Async-queue starvation + 3s polling cost → accepted with mitigations: documented in `minicomputer_deployment.md`, ops lever `--parallel 3`, Honeycomb dashboard for queue depth by run_source; SSE upgrade path documented as code-comment follow-up

Testing & CI/CD
1. UPSTASH secrets not provisioned in CI environments → new "Test Environment & Secrets" subsection itemizes staging + Production env additions + the `PUBLIC_EDIT_RATE_LIMIT_DISABLED` test-mode bypass
2. Fail-CLOSED CI failure mode (existing integration tests would break on the new RPC's first call) → kill-switch defaults `'true'`, so existing tests pass; new tests cover BOTH `'true'` (rollback) and `'false'` (fail-closed) explicitly
3. Per-IP cap tripping in CI from shared egress IP → explicit `E2E_TEST_MODE === 'true'` + `PUBLIC_EDIT_RATE_LIMIT_DISABLED === 'true'` bypass + `x-test-client-ip` header support (NODE_ENV=test only)
4. E2E strategy whitelist + test-content collision → seeded `[E2E_EVO] public-edit smoke` strategy via new `evolution/scripts/seedPublicEditE2EStrategy.ts`, with server-side carve-out in `updateStrategyAction` only when `E2E_TEST_MODE='true'`
5. Migration idempotency patterns not enumerated → explicit per-DDL idempotency contract in Phase 0 + Phase 1 migration bullets (`CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, `ADD COLUMN IF NOT EXISTS`, `set search_path`)
6. Post-deploy smoke missing `/edit` → added an assertion in `smoke.public.spec.ts` (`@smoke-public`) for `/edit` 200 + form render
7. CI path classifier (`EVOLUTION_ONLY_PATHS`) doesn't pick up `src/app/edit/` → explicit `ci.yml` regex edit in Phase 4

**Additional improvements absorbed:**
- `@critical` budget impact → full happy path moved to `@evolution`+`@skip-prod`; tiny 5s form-renders smoke retained as `@critical`+`@skip-prod`
- `attributeCallSource` exhaustiveness fix added to Phase 4
- ESLint `no-restricted-imports` rule blocks new callers of deprecated `checkPerUserCap`
- noindex/no-referrer/no-store response headers on `/edit/runs/[runId]`
- `PUBLIC_EDIT_DISABLED` operational kill switch for the public surface itself
- Sentry `beforeSend` strips user-pasted text from breadcrumbs/tags (PII defense)
- `[strategyId]` route param naming corrected from `[id]`
- Optimistic UI revert flow + structured error code + toast copy specified

Ready for iteration 2 re-review.

### Iteration 2 — Security 2/5, Architecture 3/5, Testing 3/5

**9 critical gaps surfaced (overlap across agents) + resolved:**

Security & Technical (5)
1. `reserve_per_user_daily_cost` RPC's UPSERT-with-RETURNING couldn't reject after-the-fact → switched to `SELECT … FOR UPDATE` then conditional increment, matching the existing `check_and_reserve_llm_budget` RPC at migration `20260228000001:84-117` (cited explicitly)
2. Orphan-cleanup referenced non-existent `reserved_usd` column → sibling migration adds `reserved_usd NUMERIC NOT NULL DEFAULT 0` to `per_user_daily_cost_rollups`; trigger updated to decrement on reconcile
3. `NextRequest.ip` + `.geo` don't exist in Next.js 15 → `getClientGeo` rewritten to read `x-forwarded-for` + `x-vercel-ip-country` headers directly; `x-vercel-id` trust assertion retained
4. Vercel BotID under-specified → full integration spec: `npm install @vercel/botid`, server `checkBotId(request)`, client `<BotIdClient>` provider + `useBotIdToken()` hook, dashboard toggle, `BOT_PROTECTION_DISABLED='true'` test bypass, dedicated E2E
5. Phase 1 `explanations` insert payload schema-incompatible (3 ways) — UNANIMOUS across all 3 agents → corrected via ground-truth read of `database.types.ts:1714-1735`. Now: `createTopic` per submission (matches `processImport` at `importActions.ts:119-127`), then `explanations` insert with `{explanation_title, content, primary_topic_id, status:'draft', source:'public_edit'}` — schema-verified payload. Earlier draft's `'private'` status + invented `explanation_text_type` field + missing `primary_topic_id` all corrected.

Architecture & Integration (2)
1. Insert schema gap (same as Security #5 — single fix)
2. `[EDIT]` discovery-filter extension exists at 3 sites not 1 → enumerated all 3 (`explanations.ts`, `findMatches.ts`, `adminContent.ts`) with line refs; added lock-in unit test

Testing & CI/CD (4)
1. Insert schema gap blocks integration test (same as Security #5)
2. `run_source` backfill targeted non-existent `mini-%` prefix → dropped; added correct `local` branch via `runner_id IS NULL` heuristic
3. `cleanup_orphaned_per_user_reservations` cron scheduling unspecified → picked "inline call from `processRunQueue.ts` top-of-loop" (~5 LoC, no new infra); two alternatives documented but not chosen
4. `[E2E_EVO]` carve-out logic was redundant (seeded strategy passes all natural filters) → entire carve-out removed; strategy renamed `Public Edit Smoke` to avoid `[E2E]` trigger collision; matching test bullet removed

Minor improvements absorbed:
- CI path classifier refined: `llmSpendingGate` already matches SHARED_PATHS (dead-code addition removed); `src/app/edit/` → SHARED_PATHS not EVOLUTION_ONLY_PATHS (covers non-evolution middleware tests)
- `x-vercel-id` header presence asserted in post-deploy smoke (defends against Vercel renaming the header)
- Sentry `beforeSend` predicate concretized to match real breadcrumb shape (`data.body` includes `'articleText'` → redact)
- Unit test for orphan-cleanup time-bound behavior added (pgTAP-style with `SET LOCAL` for time mocking)
- Unit test for `[EDIT]` discovery filter extension added (lock-in against future refactor)
- GUEST_USER_ID pool-sharing trade-off documented honestly (no fabricated Q7 endorsement; explicit accepted-for-v1 with follow-up path)
- Topics-table consideration documented (one `topics` row per /edit submission for v1; sentinel topic deferred)
- `evolution_runs` insert-site audit acknowledged as incomplete (~20 test fixtures); NOT NULL DEFAULT catches them implicitly with the cost-attribution caveat noted

Ready for iteration 3 re-review.

### Iteration 3 — Security 2/5, Architecture 3/5, Testing 4/5

**4 unique critical gaps (Security + Architecture overlapped on the reservation issue) + resolved:**

1. **`call_source` scoping mismatch in reservation system** (Security #1 + Architecture #1) — UNANIMOUS. The iter-2 fix added `reserved_usd` to `per_user_daily_cost_rollups` keyed on `(date, user_id, call_source='public_edit')`, but the trigger writes rows per-call_source (`evolution_<agent>`) and the cap-check sums across all call_sources. Three-way scoping mismatch meant reservations would accumulate forever without reconciling. **Fix:** new dedicated `per_user_daily_reservations` table keyed only on `(date, user_id)`. Cap-check sums `total_cost_usd` across all call_sources + `reserved_usd` from the new table. Reconcile via app-side `recordActualForUser` calling a new `reconcile_per_user_reservation` RPC. The existing trigger stays unchanged. The two tables are independent + correctly composed.

2. **Double-decrement risk on `reserved_usd`** (Security #3) — same root cause: had both trigger AND app-side decrement. **Fix:** drop the trigger-side decrement entirely; reconciliation happens ONLY via the app-side `reconcile_per_user_reservation` RPC. Mirrors the existing global-gate pattern exactly. `GREATEST(0, ...)` floor on the decrement prevents negative reservations from race conditions.

3. **Vercel BotID spec fabricated against the real API** (Security #2) — agent verified against https://vercel.com/docs/botid/get-started. **Fix:** rewrote entirely:
   - Package is `botid` (not `@vercel/botid`)
   - No `useBotIdToken()` hook — client uses `initBotId({protect: [...]})` from `botid/client/core` in `instrumentation-client.ts` (Next 15.3+)
   - Server `checkBotId()` takes NO arguments; returns `{isBot: boolean}` verdict
   - REQUIRED `withBotId()` wrapper in `next.config.ts` for ad-blocker proxy rewrites
   - `BOT_PROTECTION_DISABLED='true'` test bypass + global-default contract documented in playwright.config.ts comment

4. **Orphan-cleanup placement ambiguity** (Architecture #3) — "top-of-loop in processRunQueue.ts" could be interpreted as inside-the-while-loop, where it'd never fire on empty-queue invocations. **Fix:** explicit: call BEFORE the `while (processedRuns < MAX_RUNS)` loop at line 222-224, so cleanup runs once per systemd-timer firing even when the queue is empty.

Minor improvements absorbed:
- Stale `'public_edit_anonymous'` sentinel reference in Decisions table row 7 → corrected to `GUEST_USER_ID`
- Stale `[E2E_EVO]` carve-out references in 3 spots (integration test bullet, 2 doc-update bullets) → updated to `Public Edit Smoke`
- SHARED_PATHS regex edit made explicit (was wording-only); now both edits to `ci.yml` are itemized
- Cost-config drift lock-in test added (`Public Edit Smoke` strategy's `budgetUsd = $0.001`)
- BotID test-mode global-default contract documented in playwright.config.ts comment + environments.md
- `instrumentation-client.ts` introduced as a project-new pattern (Next 15.3+); document in env section
- `next.config.ts` `withBotId()` wrapper explicitly required

Ready for iteration 4 re-review.

### Iteration 4 — Security 5/5, Architecture 4/5, Testing 5/5

**0 critical gaps; 5 polish items applied to seal full consensus:**

1. **`instrumentation-client.ts` file location** (Architecture #1) — earlier draft said `src/instrumentation-client.ts`, but Next.js 15.3+ requires the client file to sit alongside `instrumentation.ts` (which lives at repo root in this project). Moved to `/instrumentation-client.ts`. Without this fix, Next.js would never auto-load the client file → BotID silently never initializes → the protection layer the plan was designed around silently doesn't exist.
2. **Partial index for orphan-cleanup** (Architecture #2) — added `CREATE INDEX IF NOT EXISTS idx_per_user_reservations_stale ON per_user_daily_reservations (updated_at) WHERE reserved_usd > 0` to the table migration. Predicate-aligned with the cleanup RPC's `WHERE updated_at < … AND reserved_usd > 0` clause.
3. **Cache invalidation on admin toggle** (Architecture #3) — `updateStrategyAction` now calls `listPublicStrategiesAction`'s `invalidate()` helper on successful `publicVisible` change. ~3 LoC; admin sees the change reflected on `/edit` immediately within the current serverless instance; cross-instance staleness bounded by the 60s TTL.
4. **Honeycomb event disambiguation** (Architecture #4) — split into TWO event names: `gate.fail_closed_rejected` (system-broken, HIGH priority) and `gate.guest_pool_exhausted` (cap doing its job, informational; alert only on sustained rate). Lets ops prioritize correctly.
5. **Per-IP/region eager-reservation contract** (Architecture #5) — documented explicitly that per-IP/region reservations are NOT released on downstream per-user/global cap rejections (intentional over-projection; max-leak bounded by `budget_cap_usd`).

All other minor issues from Security + Testing are acknowledged as accepted-with-documentation or nice-to-have lock-ins (RPC-name spy test, BotID `protect` array config test, distinct `withBotId` build smoke).

Ready for iteration 5 — expecting 5/5/5 consensus.

### Iteration 5 — Security 5/5, Architecture 5/5, Testing 5/5 ✅

**CONSENSUS REACHED.** All three reviewers verified the iter-4 polish items landed cleanly in the plan body (not just the changelog), confirmed zero critical gaps, and gave the plan their highest score. The minor issues that remain are all nice-to-have lock-ins (e.g. explicit assertions for `idx_per_user_reservations_stale` post-migration, Honeycomb event-name disambiguation spy in unit tests, instrumentation-client.ts auto-load smoke) that the existing test infrastructure backstops. None block execution.

### Plan Review Score Trajectory

| Iteration | Security | Architecture | Testing | Critical gaps | Action |
|---|---|---|---|---|---|
| 1 | 2 | 2 | 2 | 15 | Fixed |
| 2 | 2 | 3 | 3 | 9 | Fixed |
| 3 | 2 | 3 | 4 | 4 | Fixed |
| 4 | 5 | 4 | 5 | 0 (5 polish) | Polished |
| 5 | **5** | **5** | **5** | **0** | ✅ **Consensus** |

The plan is ready for `/plan-update` (checkbox verification) and then execution per the 5-phase plan: Phase 0 gate hardening → Phase 1 backend → Phase 2 frontend → Phase 3 admin UI → Phase 4 cost/safety polish.





