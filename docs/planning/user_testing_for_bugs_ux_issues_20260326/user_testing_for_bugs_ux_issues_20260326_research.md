# User Testing For Bugs UX Issues Research

## Problem Statement
Conduct comprehensive user testing of the ExplainAnything platform and evolution admin UI using Playwright to identify 50 bugs and UX issues. Fix all identified issues and write Playwright regression tests to ensure bugs do not recur.

## Requirements (from GH Issue #851)
I want to do comprehensive testing using playwright to identify 50 bugs and UX issues, then fix them all. Write tests to make sure any bugs do not re-occur.

Focus: Everything — test all areas including main app, evolution admin, arena, experiments, and all user flows.

## High Level Summary

8 rounds of 4 parallel research agents (32 agents total) investigated the entire codebase. Found **120+ distinct bugs and UX issues** across all areas. Below is the consolidated list of the top 50 bugs selected for fixing, organized by severity and area.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/cost_optimization.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md

## Code Files Read

### Main App Pages
- src/app/page.tsx (home)
- src/app/results/page.tsx (explanation results - 1631 lines)
- src/app/explanations/page.tsx (explore gallery)
- src/app/sources/page.tsx (source leaderboard)
- src/app/sources/[id]/page.tsx (source profile)
- src/app/userlibrary/page.tsx (user library)
- src/app/login/page.tsx (authentication)
- src/app/settings/page.tsx (theme settings)
- src/app/error.tsx, global-error.tsx (error boundaries)

### Server Actions & API Routes
- src/actions/actions.ts (50+ server actions)
- src/app/api/returnExplanation/route.ts
- src/app/api/stream-chat/route.ts
- src/app/api/runAISuggestionsPipeline/route.ts
- src/app/api/fetchSourceMetadata/route.ts
- src/app/api/client-logs/route.ts
- src/app/api/evolution/run/route.ts
- src/app/api/health/route.ts

### Services
- src/lib/services/returnExplanation.ts
- src/lib/services/explanations.ts
- src/lib/services/explanationTags.ts
- src/lib/services/linkWhitelist.ts
- src/lib/services/sourceCache.ts
- src/lib/services/auditLog.ts

### Hooks & Reducers
- src/hooks/useExplanationLoader.ts
- src/hooks/useStreamingEditor.ts
- src/hooks/useUserAuth.ts
- src/hooks/clientPassRequestId.ts
- src/reducers/pageLifecycleReducer.ts

### Components
- src/components/Navigation.tsx
- src/components/SearchBar.tsx
- src/components/home/HomeSearchPanel.tsx
- src/components/home/HomeSourcesRow.tsx
- src/components/home/HomeTagSelector.tsx
- src/components/sources/SourceCombobox.tsx
- src/components/sources/SourceEditor.tsx
- src/components/sources/SourceList.tsx
- src/components/sources/CitationTooltip.tsx
- src/components/sources/Bibliography.tsx
- src/components/explore/FeedCard.tsx
- src/components/explore/FilterPills.tsx
- src/components/explore/ExploreGalleryPage.tsx
- src/components/ui/button.tsx, card.tsx, dialog.tsx, sheet.tsx, etc.
- src/components/admin/ExplanationTable.tsx
- src/components/admin/ExplanationDetailModal.tsx
- src/components/admin/WhitelistContent.tsx
- src/components/admin/CandidatesContent.tsx

### Editor & Streaming
- src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx
- src/editorFiles/lexicalEditor/CitationPlugin.tsx
- src/editorFiles/lexicalEditor/TextRevealPlugin.tsx
- src/editorFiles/lexicalEditor/importExportUtils.ts
- src/editorFiles/aiSuggestion.ts

### Auth & Middleware
- src/lib/utils/supabase/middleware.ts
- src/app/auth/callback/route.ts
- src/app/auth/confirm/route.ts
- src/app/login/actions.ts

### Evolution Admin
- All 17 page.tsx files under src/app/admin/evolution/
- evolution/src/components/evolution/ (EntityListPage, EntityDetailHeader, EntityDetailTabs, FormDialog, ConfirmDialog, LineageGraph, LogsTab, VariantsTab, EloTab, MetricsTab, RunsTable, etc.)
- evolution/src/services/ (evolutionActions, experimentActions, arenaActions, strategyRegistryActions, invocationActions, entityActions, logActions, costAnalytics, etc.)

### E2E Test Infrastructure
- playwright.config.ts
- 53 test spec files (~178 tests)
- Test fixtures (auth, admin-auth, base)
- Test helpers (api-mocks, test-data-factory, error-utils, wait-utils)

---

## Top 50 Bugs & UX Issues (Selected for Fixing)

### CRITICAL (Bugs 1-8)

**Bug 1: Open redirect in /auth/callback**
- File: src/app/auth/callback/route.ts
- The `next` query param is concatenated with origin without validation. Attacker can craft `/auth/callback?code=valid&next=https://evil.com`
- Test file documents this: "Current implementation would redirect to http://localhost:3000https://evil.com"

**Bug 2: Open redirect in /auth/confirm**
- File: src/app/auth/confirm/route.ts
- `redirect(next)` where next comes from search params without validation
- Accepts `https://evil.com` and `//evil.com`

**Bug 3: Missing /forgot-password route**
- File: src/app/login/page.tsx line 234
- Login page links to `/forgot-password` but the route doesn't exist — dead link for core auth flow

**Bug 4: 9 server actions missing try-catch error handling**
- File: src/actions/actions.ts
- Functions at lines 379, 435, 468, 512, 531, 550, 569, 584, 616 have NO try-catch blocks
- Any DB failure causes unhandled error propagation to client

**Bug 5: Missing JSON parse error handling in 5 API routes**
- Files: returnExplanation/route.ts, stream-chat/route.ts, runAISuggestionsPipeline/route.ts, fetchSourceMetadata/route.ts, client-logs/route.ts
- `await request.json()` without try-catch; malformed JSON causes 500 errors

**Bug 6: FormDialog state not reset when dialog opens**
- File: evolution/src/components/evolution/dialogs/FormDialog.tsx
- Previous values, error messages, and loading state persist when dialog reopens
- Affects all evolution CRUD forms (prompts, strategies, experiments)

**Bug 7: FormDialog missing aria-modal, focus trap, and Escape key**
- File: evolution/src/components/evolution/dialogs/FormDialog.tsx
- Custom div-based modal without proper accessibility — can't dismiss with Escape, focus escapes

**Bug 8: ExperimentForm state not reset after successful submission**
- File: src/app/admin/evolution/_components/ExperimentForm.tsx
- After creating experiment, previous form values persist — user must reload page

### HIGH (Bugs 9-25)

**Bug 9: Missing serverReadRequestId wrapper on saveUserQuery**
- File: src/actions/actions.ts line 314
- Request ID not tracked for this action, breaking distributed tracing

**Bug 10: Parameter naming inconsistency (explanationid vs explanationId)**
- File: src/actions/actions.ts lines 512, 531, 569
- Lowercase `explanationid` and `userid` vs camelCase everywhere else

**Bug 11: Unsafe non-null assertions on array access**
- File: evolution/src/lib/shared/computeRatings.ts lines 37, 46
- `result[0]![0]!` — if openskill returns empty arrays, crashes rating system

**Bug 12: Dangerous Map.get() with non-null assertion**
- File: evolution/src/lib/pipeline/loop/rankVariants.ts lines 349-350
- `localRatings.get(entrantId)!` — if variant not in map, corrupts match results

**Bug 13: Sheet component uses hardcoded gray/slate colors**
- File: src/components/ui/sheet.tsx
- Uses `bg-white`, `dark:bg-slate-900` instead of design system CSS variables — breaks theme switching

**Bug 14: LineageGraph D3 memory leak — zoom listeners not cleaned up**
- File: evolution/src/components/evolution/visualizations/LineageGraph.tsx
- No cleanup on unmount; zoom handlers accumulate on tab switching

**Bug 15: LogsTab iteration dropdown shows fixed 20 options**
- File: evolution/src/components/evolution/tabs/LogsTab.tsx lines 130-133
- 5-iteration run shows iterations 1-20; selecting 12 returns nothing (appears broken)

**Bug 16: VariantsTab ranks renumber after strategy filter**
- File: evolution/src/components/evolution/tabs/VariantsTab.tsx
- Filtered view shows rank #1 for what is actually #3 overall — confusing

**Bug 17: RelatedRunsTab cost always shows 0**
- File: evolution/src/components/evolution/tabs/RelatedRunsTab.tsx line 26
- `cost: 0` hardcoded in normalizeExperimentRun — cost column always shows "—"

**Bug 18: Feature flag toggle lacks confirmation dialog**
- File: src/app/admin/settings/page.tsx
- Single click toggles critical production features with no "Are you sure?"

**Bug 19: WhitelistContent uses browser confirm() for delete**
- File: src/components/admin/WhitelistContent.tsx line 135
- Inaccessible native `confirm()` instead of proper modal dialog

**Bug 20: Race condition in experiment batch creation rollback**
- File: evolution/src/services/experimentActions.ts lines 162-197
- Rollback deletes don't check for errors — orphaned data on partial failure

**Bug 21: Missing null checks after .single() in arena actions**
- File: evolution/src/services/arenaActions.ts lines 103-115, 157-169
- `.single()` can return null data, but code only checks `if (error)`

**Bug 22: Pagination validation missing in multiple evolution actions**
- Files: arenaActions.ts, strategyRegistryActions.ts
- No limit clamping — negative or huge values accepted (potential DoS)

**Bug 23: Callback prop race condition in useExplanationLoader**
- File: src/hooks/useExplanationLoader.ts lines 136-149, 348
- Inline callbacks in dependency array cause potential infinite re-render loops

**Bug 24: Stale closure in useStreamingEditor debounce**
- File: src/hooks/useStreamingEditor.ts lines 48-74
- setTimeout captures stale `isStreaming` value; debounce fires with wrong timing

**Bug 25: Stream timeout interval not cleared on early returns**
- File: src/app/results/page.tsx lines 370-417
- When stream errors, interval continues running — memory leak

### MEDIUM (Bugs 26-50)

**Bug 26: Unsafe non-null assertions in loadAISuggestionSessionAction**
- File: src/actions/actions.ts lines 1701-1707
- `firstRecord.session_id!` etc. — DB fields might be null

**Bug 27: Inconsistent error response shapes across actions**
- File: src/actions/actions.ts
- Some return `{success, error}`, others `{data, error}` (no success field)

**Bug 28: stream-chat returns plain text error instead of JSON**
- File: src/app/api/stream-chat/route.ts line 108
- `new Response('Internal Server Error', {status: 500})` breaks client JSON parsing

**Bug 29: Missing maxDuration on streaming routes**
- Files: returnExplanation/route.ts, stream-chat/route.ts
- No explicit maxDuration — Vercel default could interrupt long streams

**Bug 30: Auth check inconsistency (error vs !data)**
- File: src/app/api/runAISuggestionsPipeline/route.ts line 22
- Checks `authResult.error` instead of `!authResult.data` like other routes

**Bug 31: Debounce race in StreamingSyncPlugin**
- File: src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx lines 35-70
- Multiple concurrent editor.update() calls without lock mechanism

**Bug 32: Missing content sync validation when switching editor modes**
- File: src/app/results/page.tsx lines 644-672
- Empty string from editor can overwrite existing content when switching modes

**Bug 33: CitationTooltip component implemented but never used**
- File: src/components/sources/CitationTooltip.tsx
- Inline citations [n] have no hover tooltip — feature built but not wired up

**Bug 34: SourceEditor missing pre-apply source count validation**
- File: src/components/sources/SourceEditor.tsx lines 88-112
- No UI check before submission — user gets cryptic error instead of friendly message

**Bug 35: SourceList doesn't count loading sources toward 5-source limit**
- File: src/components/sources/SourceList.tsx line 58
- 4 success + 1 loading = attempt to add 6th source succeeds

**Bug 36: EloTab chart renders misleading y-axis with uniform data**
- File: evolution/src/components/evolution/tabs/EloTab.tsx lines 57-65
- All variants at mu=50 shows axis 49-51, implying huge variance

**Bug 37: VariantsTab empty state missing after filter**
- File: evolution/src/components/evolution/tabs/VariantsTab.tsx
- When filter removes all variants, blank table shows — no "No matches" message

**Bug 38: EntityDetailHeader copy-ID button has no keyboard support**
- File: evolution/src/components/evolution/sections/EntityDetailHeader.tsx
- No `role="button"` or keyboard handler — keyboard users can't copy IDs

**Bug 39: ExperimentForm budget input accepts invalid values**
- File: src/app/admin/evolution/_components/ExperimentForm.tsx lines 284-290
- HTML min/max are advisory only; user can type -5 or 999 in number field

**Bug 40: Kill switch confirm button not disabled during submission**
- File: src/app/admin/costs/page.tsx line 250
- Rapid clicks can toggle kill switch multiple times

**Bug 41: Audit log filter dropdown missing action types**
- File: src/app/admin/audit/page.tsx
- `toggle_kill_switch`, `update_cost_config`, `queue_evolution_run` not in filter

**Bug 42: Whitelist snapshot version race condition**
- File: src/lib/services/linkWhitelist.ts lines 319-350
- Concurrent rebuilds read same version, both increment to same number

**Bug 43: No skip-navigation link**
- File: src/components/Navigation.tsx
- Keyboard users must tab through entire nav before reaching content

**Bug 44: Color-only status indicators (admin dashboard)**
- File: src/app/admin/page.tsx
- System health shown as colored dot only — inaccessible to color-blind users

**Bug 45: Missing focus indicators on FilterPills buttons**
- File: src/components/explore/FilterPills.tsx
- No focus-visible ring styling — keyboard users can't see focused button

**Bug 46: Table headers missing scope attributes (evolution tables)**
- File: evolution/src/components/evolution/tabs/MetricsTab.tsx
- `<th>` elements without `scope="col"` — screen readers can't navigate

**Bug 47: Form error messages not associated to inputs (FormDialog)**
- File: evolution/src/components/evolution/dialogs/FormDialog.tsx
- No `aria-describedby` linking inputs to their error messages

**Bug 48: Missing SEO metadata on explore page**
- File: src/app/explanations/page.tsx
- No `generateMetadata` export — poor search engine discoverability

**Bug 49: Debug routes accessible in production**
- File: src/lib/utils/supabase/middleware.ts lines 44-45
- `/debug-critic` and `/test-global-error` bypass auth entirely

**Bug 50: Z-index conflict between Sheet and ReportContentButton**
- File: src/components/ui/sheet.tsx (z-[60]) vs ReportContentButton (z-[100])
- Overlapping modals stack unpredictably

## Open Questions
- Should we implement /forgot-password or just remove the dead link?
- What's the priority for accessibility fixes vs functional bugs?
- Should rate limiting be added as part of this project or as a separate effort?
