# Build Website for Evolution Plan

## Background
Help me build a user facing website for evolution.

## Requirements (from GH Issue #NNN)
Build a front-end and stop experimenting.

- Choose a good URL.
- User can paste in any article.
- It can run a pipeline using a set strategy that is selectable via the UI.
- Can see final output, and a diff against the initial input side-by-side. Following the existing pattern on variant details tab for diff against parent.

## Problem
The evolution pipeline currently has no user-facing surface — all entry points are admin-gated (admin UI, API route, batch runner, local script). There is no way for an unprivileged user to paste in an article, pick a strategy, run it, and see the improved output. The hypothesis: a public-facing website fronting the pipeline turns evolution from an experiment into a product, validating whether the quality gains are useful to real readers/writers rather than just measurable on the leaderboard.

## Options Considered
- [ ] **Option A: Public host (`explainanything.vercel.app`) — third middleware route**: Add the paste/run/view flow to the existing public hostname alongside the search-and-explain flow. Reuses the existing public-site auth (guest auto-login), middleware, layout, and design system. Lowest infra change; cleanest if the website is "for everyone who reads ExplainAnything."
- [ ] **Option B: New dedicated hostname**: Spin up a third hostname (e.g. `evolve.explainanything.app` or similar) configured via `src/config/hostnames.ts`, with its own middleware-gated route set. Cleaner isolation (different cookie jar, separate Sentry tag, separate analytics) at the cost of new DNS + Vercel domain config + an `EVOLVE_*` env-var family.
- [ ] **Option C: Single page on the evolution admin host**: Reuse the existing `ea-evolution.vercel.app` host but expose ONE non-admin route. Probably the wrong choice — the host is admin-only by `requireAdmin()` semantics and conflating public + admin on one hostname creates the exact ambiguity the Option B website split was designed to fix.

URL choice (the "good URL" requirement) is a sub-decision under whichever hosting option wins. Candidates if Option B: `evolve.explainanything.app`, `evolveanything.app`, `rewrite.explainanything.app`. Decision deferred to /research findings + AskUserQuestion.

## Phased Execution Plan

### Phase 1: Research & Decide
- [ ] Read the existing public-site flow (`src/app/page.tsx`, `SearchBar`, `returnExplanation`) to understand the layout, auth, and styling baseline.
- [ ] Map the path from "pasted text" → `evolution_runs` row → `claimAndExecuteRun` → finalized variant — confirm we can reuse `claimAndExecuteRun` directly or need a thin wrapper.
- [ ] Decide hosting (Option A/B/C) — present the trade-offs and ask the user.
- [ ] Decide the public-strategy whitelist: which `evolution_strategies` rows are safe to expose (filter by cost, by agent type, by `is_test_content`).
- [ ] Decide cost guardrails: per-IP cap, per-session cap, daily-budget reservation for the public surface.

### Phase 2: Backend Plumbing
- [ ] Add a server action / API route that accepts `{ articleText, strategyId }`, validates length + sanitizes input, creates a new `evolution_explanations` row (`source='explanation'` or a new value TBD), inserts a `pending` `evolution_runs` row, and returns `{ runId }`.
- [ ] Decide synchronous vs async execution: run inline (Vercel `maxDuration=300`) — fast feedback, hits Vercel timeout on a 5-iteration run — or queue-and-poll (insert pending, let the minicomputer pick it up via the existing claim path). Queue-and-poll is more robust; inline is simpler. Decision in planning.
- [ ] Expose a `getPublicStrategiesAction` server action that returns the whitelisted strategies with display label + estimated cost.
- [ ] Expose a `getRunForUserAction` (and a SSE / polling endpoint) that returns the run's current status, winning variant content, and original input, gated by a per-session ownership check.

### Phase 3: Frontend
- [ ] Page route: paste form (textarea + strategy `<select>` + Submit) at the chosen URL.
- [ ] Page state machine (reuse `pageLifecycleReducer` pattern): idle → submitting → running → viewing → error.
- [ ] Results view: `SideBySideWordDiff` (Original left / Winning variant right) + a header showing the strategy used, runtime, and cost. Match the variant-details tab pattern precisely.
- [ ] Loading / progress UI while the run is in flight (iteration count, status, cost-so-far if available — auto-refresh à la `AutoRefreshProvider`).

### Phase 4: Cost, Safety, Polish
- [ ] Per-IP / per-session rate limit (e.g. 3 runs per 24h on the guest session).
- [ ] Article-length cap + basic content sanitization.
- [ ] Public hostname assertion: depending on hosting decision, ensure `classifyHost()` recognizes the new surface and middleware lets it through.
- [ ] Sentry + analytics tagging for the new flow.

## Testing

### Unit Tests
- [ ] `src/lib/services/publicEvolution.test.ts` — validation + cost-cap helpers
- [ ] (additional unit test files TBD based on Phase 2 service boundaries)

### Integration Tests
- [ ] `src/__tests__/integration/public-evolution.integration.test.ts` — paste → insert run → claim → finalize → read winner end-to-end against staging DB with a mocked LLM
- [ ] Cost / rate-limit gate tests

### E2E Tests
- [ ] `src/__tests__/e2e/specs/<area>/public-evolution.spec.ts` — paste an article, pick a strategy, see the diff (with route-mocked SSE) — `@critical` if it's on the public host

### Manual Verification
- [ ] Paste a real article on the local server, pick the smallest-budget whitelisted strategy, watch the run complete, verify the side-by-side diff matches the variant-details tab visually
- [ ] Verify on a fresh guest session that the rate limit kicks in after the cap

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Local dev server (`ensure-server.sh`) + Playwright MCP — load the new route, paste a 500-word article, pick a strategy, assert the diff renders Original-vs-Winner and the strategy/cost header is present
- [ ] Visual check against the existing variant-details diff tab — same fonts, same colors, same side-by-side gutter

### B) Automated Tests
- [ ] `npx playwright test src/__tests__/e2e/specs/<area>/public-evolution.spec.ts`
- [ ] `npm run test:integration -- --testNamePattern="public-evolution"`
- [ ] `npm test -- src/lib/services/publicEvolution.test.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/design_style_guide.md` — only if a new component variant is introduced
- [ ] `docs/feature_deep_dives/server_action_patterns.md` — add the new public-facing action to the action catalog if added
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — likely unchanged (reusing `SideBySideWordDiff`)
- [ ] `docs/feature_deep_dives/authentication_rls.md` — update hostname split section if a third hostname is added; document any new middleware allowlist entries
- [ ] `docs/feature_deep_dives/state_management.md` — note the new page-lifecycle instance if the public flow gets its own reducer
- [ ] `evolution/docs/architecture.md` — add the new public-facing entry point alongside the existing four
- [ ] `evolution/docs/data_model.md` — note any new `evolution_runs` source semantics or new column for public runs
- [ ] `evolution/docs/strategies_and_experiments.md` — document the public-strategy whitelist mechanism
- [ ] `evolution/docs/visualization.md` — non-admin UI is out of its scope, but cross-link the public surface
- [ ] `evolution/docs/arena.md` — likely unchanged
- [ ] `evolution/docs/cost_optimization.md` — document the per-IP / per-session public cap layer
- [ ] `evolution/docs/reference.md` — add files + env vars introduced for the public surface
- [ ] (other docs from `_status.json` checked + ticked / dismissed as part of /finalize)

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
