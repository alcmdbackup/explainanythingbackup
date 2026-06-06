# Match Viewer With Experimentation Procedures Progress

## Phase 1: Read path — match list + detail
### Work Done
- `getRecentMatchesAction` + `getComparisonDetailAction` in `evolution/src/services/arenaActions.ts`
  (run-id/winner/min-confidence filters, pagination, variant-content previews, two-level
  `!inner` test-content embed, orphan-safe content join).
- List page `src/app/admin/evolution/matches/page.tsx` (EntityListPage; run-id/winner/
  confidence/Hide-test-content filters; server pagination; winner badge + confidence).
- Detail page `src/app/admin/evolution/matches/[comparisonId]/page.tsx` (metadata + stored
  verdict + side-by-side texts, orphan placeholder for deleted variants).
- `Tools` nav group in `src/components/admin/EvolutionSidebar.tsx` (Match Viewer).
- Dashboard `Tools` quick-link (`src/app/admin/evolution-dashboard/page.tsx`).
- Deep-link: `VariantMatchEntry.comparisonId` added (`variantDetailActions.ts`) + "Open"
  link per row in `VariantMatchHistory.tsx`.

### Issues Encountered
- Pre-existing `consistent-type-assertions` lint error in `variantDetailActions.ts` (an
  `as never` RPC arg) surfaced once the file was touched; fixed minimally by extracting the
  object literal to a named const.

### User Clarifications
- "Linked from the evolution admin dashboard": the generic quick-links row was intentionally
  removed (U20), so added a single deliberate `Tools` link rather than resurrecting the row.

## Phase 2: Realtime re-judge sandbox (display-only)
### Work Done
- `buildComparisonPrompt` extended with optional `customPromptOverride` + `explainReasoning`
  (sandbox path only; default pipeline path byte-for-byte unchanged) and new reasoning-tolerant
  `parseVerdictFromReasoning` (`computeRatings.ts`).
- `rejudgeComparisonAction` (`arenaActions.ts`): display-only 2-pass via `run2PassReversal`
  driven directly (bypasses the comparison cache); plain `callLLM` path (no `db`/`runId` → no
  `evolution_metrics` write; no comparison/ratings mutation); per-pass prompt+rawResponse
  capture; model validated against the picker set; temperature clamped via `getModelMaxTemperature`;
  input caps on variant content + custom prompt; `GlobalBudgetExceededError`/`LLMKillSwitchError`
  surfaced cleanly; `E2E_TEST_MODE` stub with prod guard.
- Sandbox UI on the detail page: model picker (reasoning models flagged), rubric toggle,
  temperature slider (hidden when model max-temp is null/undefined), Explain-reasoning toggle,
  collapsible custom-prompt textarea, stacked result cards with per-pass collapsible
  prompt/output and a "not persisted" marker.

### Issues Encountered
- Deviation from plan literal: added the new params to `buildComparisonPrompt` ONLY (not
  `compareWithBiasMitigation`) — the sandbox drives `run2PassReversal` directly, so touching
  the hot pipeline primitive was unnecessary and lower-risk.
- Override "missing markers" rejection is largely defensive: the builder always injects
  `## Text A`/`## Text B`/`Your answer:`, so markers are guaranteed present. The pre-LLM
  rejection that is genuinely reachable is the over-long custom prompt (tested).

### User Clarifications
- Temperature IS changeable (verified): the temp=0 forcing is only in the evolution ranking
  client, which re-judge bypasses. 2-pass reversal kept (no single-pass toggle).

## Phase 2.5: Match type filter + column + Match ID link (follow-up request)
### Work Done
- `getRecentMatchesAction`: added `kind` (article/paragraph) derived from
  `evolution_prompts.prompt_kind` — left-join embed `evolution_prompts(prompt_kind)` for the
  label (keeps null-prompt rows), `evolution_prompts!inner(prompt_kind)` + `.eq` when filtering.
  `MatchKind` type + `kind` on `MatchListItem`.
- List page: "Type" filter (All/Article/Paragraph) + "Type" badge column; **Match ID** is now
  the clickable link (8-char, full UUID on hover) instead of the Created date.
- Tests: unit kind-filter + embed-string assertions (8/8); integration article-includes/
  paragraph-excludes against real DB (4/4); E2E re-run 2/2.

### Issues Encountered
- Verified the PostgREST embed syntax with a throwaway integration check before building:
  the FK on `prompt_id` is legacy-named `..._topic_id_fkey` → `evolution_prompts`, but
  `evolution_prompts(prompt_kind)` / `evolution_prompts!inner(prompt_kind)` both resolve.
- Staging data: only 0.56% of comparison rows have a null `prompt_id`, so prompt_kind is a
  reliable signal; those rows show a "—" type and appear only under "All types".

## Phase 3: Tests, checks
### Work Done
- Unit: `computeRatings.sandbox.test.ts` (override path + reasoning parser), 
  `arenaActions.matchViewer.test.ts` (query building, no-DB-write, callLLM model+temp, passes,
  pre-LLM rejections); updated `VariantMatchHistory.test.tsx` fixtures.
- Integration: `evolution-match-viewer.integration.test.ts` (run-id isolation, !inner
  test-content exclusion, content join; auto-skips when evolution tables absent).
- E2E: `admin-evolution-matches.spec.ts` (@evolution; resetFilters, run-id filter, detail,
  display-only re-judge via E2E_TEST_MODE stub).
- Checks: lint + tsc + `npm run build` all green; unit suites for touched areas pass.

### Issues Encountered
- E2E iterated twice on test-only bugs (app UI was correct): (1) `createTestPrompt()`'s fixed
  default text collided with the `uq_arena_topic_prompt` unique constraint → seed with a
  `randomUUID()` prompt; (2) for a text filter, `EntityListPage` puts `data-testid` on the
  `<input>` itself (only checkboxes wrap a label) → selector `[data-testid="filter-runId"]`,
  not `… input`. Final: `2 passed (31.1s)` against the live dev server.
