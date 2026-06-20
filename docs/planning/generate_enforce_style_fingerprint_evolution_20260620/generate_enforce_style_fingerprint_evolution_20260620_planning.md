# Generate Enforce Style Fingerprint Evolution Plan

## Background
Generate a style fingerprint in a piece and make it enforceable on article generation. The fingerprint is a short but accurate description of a writer's style (sentence length, American vs. British terms, idiosyncratic words/phrases, etc.). It will later be injected into a generation prompt to guide article generation and into a rubric to help judge stylistic accuracy vs. expectation.

## Requirements (from GH Issue #NNN)
Compute up with a short but accurate description of a writer's style

Note things like sentence length, American vs. British terms, etc. See what matters and then document it.

Note idiosycratic words/phrases that the author uses, but don't overuse them

This will later be injected into a prompt to guide generation, and into a rubric to help judge stylistic accuracy vs. expepctation

### Additional requirements (user, 2026-06-20)
- The fingerprint is a **top-level, independently-saved entity** with its own entry in the **left nav of the evolution admin dashboard** (the "Entities" group), mirroring Strategies / Criteria / Prompts.
- A fingerprint is **computed over a SET of articles** (1+), not a single piece.
- An existing fingerprint (and its underlying set) can be **modified by adding a new article**, which triggers a full recompute.

## Problem
The evolution pipeline has no explicit, reusable, machine-readable description of a target writer's style. Generated variants drift from the intended voice, and there is no objective signal for how stylistically faithful a variant is. We need a **first-class StyleFingerprint entity** — computed (and incrementally recomputed) over a set of source articles, authored and managed in the evolution admin dashboard — that can be (1) injected into the generation prompt to steer output toward the target voice, and (2) injected into the judging rubric to score stylistic accuracy vs. the fingerprint, without overusing the author's signature phrases.

## Decisions (locked with user — see research doc)
| Topic | Decision |
|---|---|
| Scope | Evolution pipeline only (main app out) |
| Enforcement | Per-strategy opt-in flag (`styleFingerprintEnabled` + `styleFingerprintId`) |
| Representation | Structured JSONB traits + rendered prose block |
| Entity | Top-level DB-first entity + left-nav entry (mirrors criteria/prompt) |
| Article set | Each member is EITHER an `explanation_id` ref OR pasted `article_text` |
| Update | Full recompute over the enlarged set on each add |
| Run binding | Run stores `style_fingerprint_id` + a JSONB snapshot at run start |
| Judge wiring | Fingerprint prose appended as runtime "target style" context to the rubric prompt; one `stylistic_accuracy` criteria row |
| Admin UI | Full-featured: registry list + detail (Overview/Articles/Runs/Metrics) + create/edit + article add/remove/reorder + re-extract |
| Cost | Fingerprint-level `total_extraction_cost` metric (not run `seed_cost`) |
| No-op | Authored entities only; runs without a referenced fingerprint skip injection |
| Acceptance | Human spot-check for v1 (no automated gate) |

## Options Considered
- [x] **Entity model: first-class table vs per-run JSONB** — CHOSE first-class `evolution_style_fingerprints` entity (mirrors `evolution_criteria`/`evolution_prompts`). Per-run JSONB rejected: cannot be independently saved, reused, or built over a multi-article set.
- [x] **Update strategy: full recompute vs incremental merge vs cached-per-article aggregate** — CHOSE full recompute (deterministic, no drift; extraction is infrequent CRUD-time work).
- [x] **Run binding: reference-only vs reference+snapshot** — CHOSE reference + snapshot (reproducibility of historical runs).
- [x] **Judge wiring: runtime-context vs per-variant adherence scorer vs defer** — CHOSE runtime-context appended to the existing pairwise rubric judge (smallest judge-code change, reuses criteria infra).
- [ ] **Open (resolve in build): fingerprint trait shape** — exact structured fields (see Phase 3 schema draft).

---

## Architecture at a glance

```
                 ┌─────────────────────────── Admin UI (Phase 6) ──────────────────────────┐
                 │  Left nav "Style Fingerprints" → list → detail(Overview/Articles/Runs)   │
                 └───────────────┬──────────────────────────────────────┬──────────────────┘
                                 │ server actions (Phase 2)              │
                 ┌───────────────▼──────────────┐         ┌─────────────▼───────────────┐
                 │ styleFingerprintActions.ts   │         │   extractStyleFingerprint()  │
                 │ create/update/delete/list +  │────────▶│   (Phase 3, EvolutionLLM     │
                 │ addArticle/removeArticle/    │ recompute│   client, AgentName          │
                 │ reorder/reExtract            │         │   'style_extraction')        │
                 └───────────────┬──────────────┘         └─────────────┬───────────────┘
                                 │                                        │ writes
                 ┌───────────────▼────────────────────────────────────────▼──────────────┐
                 │ DB (Phase 1): evolution_style_fingerprints                              │
                 │              evolution_style_fingerprint_articles (junction)            │
                 │              evolution_runs.style_fingerprint_id + _snapshot            │
                 └───────────────┬────────────────────────────────────────────────────────┘
   run start (strategy opt-in)   │ resolve + snapshot
                 ┌───────────────▼──────────────┐
                 │ AgentContext.styleFingerprint │ (Phase 4)
                 └───────┬───────────────┬───────┘
       ┌─────────────────▼───┐    ┌──────▼───────────────────────┐
       │ buildEvolutionPrompt │    │ buildRubricComparisonPrompt  │
       │ + styleGuide (gen)   │    │ + target-style ctx (judge)   │
       └──────────────────────┘    └──────────────────────────────┘
                (Phase 4)                      (Phase 5)
```

---

## Phased Execution Plan

### Phase 1: Data model (migration + schemas + types)
- [ ] Migration `supabase/migrations/<ts>_create_evolution_style_fingerprints.sql` (idempotent, follows `20260503033102_create_evolution_criteria.sql`):
  - `evolution_style_fingerprints`: `id UUID PK`, `name TEXT NOT NULL UNIQUE` with `CHECK (name ~ '^[A-Za-z][a-zA-Z0-9_-]{0,128}$')`, `description TEXT`, `fingerprint JSONB` (structured traits), `fingerprint_prose TEXT`, `article_count INT NOT NULL DEFAULT 0`, `status TEXT DEFAULT 'active' CHECK (status IN ('active','archived'))`, `is_test_content BOOLEAN NOT NULL DEFAULT FALSE`, `archived_at`, `deleted_at`, `created_at`, `updated_at`.
  - BEFORE INSERT/UPDATE OF name trigger → `evolution_is_test_name(NEW.name)` (same pattern as criteria).
  - RLS: `deny_all` + `service_role_all` + `readonly_local SELECT`; `REVOKE ALL FROM PUBLIC, anon, authenticated`.
  - Indexes: `(status)`, `(is_test_content)`, partial `(id) WHERE deleted_at IS NULL AND status='active'`, name search.
- [ ] Same migration (or sibling): `evolution_style_fingerprint_articles` junction — `id UUID PK`, `fingerprint_id UUID NOT NULL REFERENCES evolution_style_fingerprints(id) ON DELETE CASCADE`, `explanation_id UUID NULL REFERENCES explanations(id) ON DELETE SET NULL`, `article_text TEXT NULL`, `position INT NOT NULL DEFAULT 0`, `added_at TIMESTAMPTZ DEFAULT now()`. `CHECK ((explanation_id IS NOT NULL) <> (article_text IS NOT NULL))` (exactly one source). GIN/btree indexes on `fingerprint_id`, `(fingerprint_id, position)`.
- [ ] Migration: `ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS style_fingerprint_id UUID`, `ADD COLUMN IF NOT EXISTS style_fingerprint_snapshot JSONB` (idempotent).
- [ ] Migration: extend `evolution_metrics.entity_type` allowed set to include `'style_fingerprint'` (for `total_extraction_cost`).
- [ ] Migration: seed the `stylistic_accuracy` row in `evolution_criteria` (name legal; `evaluation_guidance` 3-anchor rubric incl. an anti-overuse penalty anchor). Idempotent insert (`ON CONFLICT (name) DO NOTHING`).
- [ ] Zod (`evolution/src/lib/schemas.ts`): `styleFingerprintTraitsSchema` (Phase 3), `evolutionStyleFingerprintInsertSchema` (name regex, status enum, soft-delete, is_test_content), `evolutionStyleFingerprintFullDbSchema`, `evolutionStyleFingerprintArticleSchema`. Add `styleFingerprintEnabled: z.boolean().optional()` + `styleFingerprintId: z.string().uuid().optional()` to `strategyConfigSchema`. Export types from `evolution/src/lib/index.ts`.
- [ ] `npm run db:types` → regen `src/lib/database.types.ts`.

### Phase 2: Entity registration backbone
- [ ] `evolution/src/lib/core/types.ts`: add `'style_fingerprint'` to `CORE_ENTITY_TYPES`.
- [ ] New `evolution/src/lib/core/entities/StyleFingerprintEntity.ts` extending `Entity<EvolutionStyleFingerprintFullDb>` — `type='style_fingerprint'`, `table='evolution_style_fingerprints'`, `renameField='name'`, `parents:[]`, `children:[]`, `listColumns`/`listFilters` (incl. Hide-test checkbox), `actions` (rename/edit/delete), `detailTabs` (Overview/Articles/Runs/Metrics), `insertSchema`, `metrics` (atFinalization: `total_extraction_cost`).
- [ ] `evolution/src/lib/core/entityRegistry.ts`: import + register `style_fingerprint: new StyleFingerprintEntity()`. Keep `evolution/src/lib/metrics/registry.ts` in sync (note in file: two parallel registries).
- [ ] New `evolution/src/services/styleFingerprintActions.ts` (`adminAction` wrappers, mirror `criteriaActions.ts`): `listStyleFingerprintsAction`, `getStyleFingerprintDetailAction`, `createStyleFingerprintAction`, `updateStyleFingerprintAction`, `deleteStyleFingerprintAction`, `archiveStyleFingerprintAction`, plus article-set ops: `addArticleToFingerprintAction`, `removeArticleFromFingerprintAction`, `reorderFingerprintArticlesAction`, `reExtractFingerprintAction`. Each set-mutating action triggers recompute (Phase 3) + updates `article_count` + `updated_at`.

### Phase 3: Extraction + prose rendering
- [ ] Trait schema `styleFingerprintTraitsSchema` (draft): `{ sentenceLength: {avgWords:number, distribution:string}, spellingRegion: 'american'|'british'|'mixed', vocabularyLevel: string, tone: string[], signaturePhrases: {phrase:string, frequency:'rare'|'occasional'}[], structuralHabits: string[], punctuationHabits: string[], summary: string }`. (Refine during build.)
- [ ] `evolution/src/lib/core/agentNames.ts`: add `'style_extraction'` to `AGENT_NAMES`; map to a `total_extraction_cost` bucket (fingerprint-level) in `COST_METRIC_BY_AGENT` or document the dedicated path.
- [ ] New `evolution/src/lib/pipeline/setup/extractStyleFingerprint.ts`: `extractStyleFingerprint(articles: string[], llm: EvolutionLLMClient): Promise<StyleFingerprintTraits>` — one structured `llm.complete(prompt, 'style_extraction', { schema })` call over the concatenated/sampled article set. Prompt explicitly instructs: identify what *matters* (don't over-enumerate), capture sentence length / spelling region / signature phrases, and **flag signature phrases for sparing use — do NOT overuse**.
- [ ] `renderFingerprintProse(traits): string` — deterministic prose block used by both generation + judging (includes the explicit anti-overuse directive).
- [ ] Wire recompute into Phase 2 actions: on create / add / remove / reorder / re-extract → load full set → `extractStyleFingerprint` → persist `fingerprint` + `fingerprint_prose` + `article_count`. Cost recorded via `llmCallTracking` + `total_extraction_cost` on the fingerprint entity.

### Phase 4: Generation injection
- [ ] `evolution/src/lib/pipeline/loop/buildPrompts.ts`: add optional `styleGuide?: string` param to `buildEvolutionPrompt`, rendered as a `## Target Style` block between `## Task`/instructions and `FORMAT_RULES`. No behavior change when undefined.
- [ ] `evolution/src/lib/core/types.ts` `AgentContext`: add `styleFingerprint?: { prose: string; traits: StyleFingerprintTraits }`.
- [ ] `evolution/src/lib/pipeline/setup/buildRunContext.ts` (+ `claimAndExecuteRun.ts`): when the strategy config has `styleFingerprintEnabled && styleFingerprintId`, resolve the fingerprint at run start, write `evolution_runs.style_fingerprint_id` + `style_fingerprint_snapshot`, and populate `AgentContext.styleFingerprint` from the snapshot. Else leave undefined (clean no-op).
- [ ] `evolution/src/lib/core/agents/generateFromPreviousArticle.ts`: add `styleFingerprint?` to `GenerateFromPreviousInput`; pass `input.styleFingerprint?.prose` into BOTH the `customPrompt` branch and the `buildPromptForTactic` branch of `buildEvolutionPrompt`. Thread from the agent context.
- [ ] (Optional) `proposerApproverCriteriaGenerate.ts`: replace the hardcoded "Preserve the author's voice…" soft rule with the fingerprint prose when present.

### Phase 5: Judging injection
- [ ] `evolution/src/lib/shared/rubricJudge.ts` (`buildRubricComparisonPrompt`): when a run snapshot fingerprint is present, append a `Target style (the author voice both variants should match):\n<prose>` block so the `stylistic_accuracy` dimension has an explicit expectation. Static criterion anchors stay generic; the per-run expectation rides as runtime context.
- [ ] Thread the run's `style_fingerprint_snapshot` prose into the judge path (resolve where comparison prompts are built for ranking). Respect existing `EVOLUTION_RUBRIC_JUDGING_ENABLED` kill switch.
- [ ] Ensure `stylistic_accuracy` dimension is available to attach to a judge rubric (seeded Phase 1); document how to add it to a strategy's `judgeRubricId` bundle.

### Phase 6: Admin UI (full-featured)
- [ ] `src/components/admin/EvolutionSidebar.tsx`: add `{ href:'/admin/evolution/style-fingerprints', label:'Style Fingerprints', icon:'🎨', testId:'evolution-sidebar-nav-style-fingerprints', description:'Author & manage style fingerprints' }` to the **Entities** group.
- [ ] `src/app/admin/evolution/style-fingerprints/page.tsx` — registry list (copy `criteria/page.tsx`): `EntityListPage`, `listStyleFingerprintsAction`, columns (name, article_count, spelling region, updated_at), Hide-test-content filter, Create button + `FormDialog`, row → detail.
- [ ] `src/app/admin/evolution/style-fingerprints/[styleFingerprintId]/page.tsx` + `StyleFingerprintDetailContent.tsx` — tabs: **Overview** (traits + rendered prose + re-extract button), **Articles** (list + add/remove/reorder), **Runs** (runs referencing it), **Metrics** (`total_extraction_cost`, article_count).
- [ ] New `src/components/admin/evolution/ArticleCombobox.tsx` (model on `src/components/sources/SourceCombobox.tsx`): search/select existing explanations OR paste raw text; calls `addArticleToFingerprintAction`. Reorder via up/down controls; remove via row action.
- [ ] Create/Edit `FormDialog` (name + description; articles managed on the detail page). Auth is automatic via `/admin/evolution/layout.tsx` (admin + hostname).

### Phase 7: Tests, docs, verification
- [ ] Unit + integration + E2E (see Testing). Docs (see Documentation Updates). Run full `/finalize` check trio.

---

## Wireframes

### W1 — Left nav (Entities group, new entry)
```
Evolution
├ Overview
│   📊 Dashboard
│   🧪 Start Experiment
├ Entities
│   🔬 Experiments
│   📝 Prompts
│   ⚙️  Strategies
│   ⚔️  Tactics
│   🎯 Criteria
│   🎨 Style Fingerprints   ◀── NEW  (data-testid=evolution-sidebar-nav-style-fingerprints)
│   🔄 Runs
│   🤖 Invocations
│   📄 Variants
├ Results
│   🏟️  Arena
└ Tools …
```

### W2 — Registry list  `/admin/evolution/style-fingerprints`
```
┌ Evolution ▸ Style Fingerprints ─────────────────────────────────────────────┐
│  Style Fingerprints                              [ + New Fingerprint ]        │
│  ☑ Hide test content        🔎 [ search name…            ]                    │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Name              │ Articles │ Spelling │ Updated      │ Actions          │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ hemingway_terse   │    4     │ american │ 2026-06-20   │ Edit  ⋮ (Delete) │ │
│ │ economist_house   │   12     │ british  │ 2026-06-19   │ Edit  ⋮          │ │
│ │ … (rows link to detail)                                                   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### W3 — Detail · Overview tab  `/style-fingerprints/[id]`
```
┌ Evolution ▸ Style Fingerprints ▸ hemingway_terse ───────────────────────────┐
│ hemingway_terse                                  [ Re-extract ] [ Edit ]     │
│ ( Overview )  Articles  Runs  Metrics                                        │
│ ┌─ Structured traits ───────────────┐ ┌─ Rendered prose (used in prompts) ─┐ │
│ │ Sentence length : ~11 words, short│ │ Write in a terse, declarative voice│ │
│ │ Spelling        : american        │ │ averaging ~11-word sentences. Prefer│ │
│ │ Tone            : terse, plain     │ │ concrete nouns… Use signature phrases│ │
│ │ Signature phrases:                 │ │ ("and so", "it was good") SPARINGLY —│ │
│ │   • "and so"        (occasional)   │ │ never force them. American spelling. │ │
│ │   • "it was good"   (rare)         │ │ …                                    │ │
│ │ Structural      : few subordinate  │ └──────────────────────────────────────┘ │
│ │ Article count   : 4                │   ⚠ anti-overuse directive embedded      │
│ └────────────────────────────────────┘                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### W4 — Detail · Articles tab (add / remove / reorder → triggers recompute)
```
┌ … ▸ hemingway_terse ▸ Articles ─────────────────────────────────────────────┐
│ Underlying set (4)            Adding/removing recomputes the fingerprint.     │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ⠿ 1  The Old Man and the Sea (excerpt)   [explanation ↗] [↑][↓] [Remove]  │ │
│ │ ⠿ 2  A Clean, Well-Lighted Place         [pasted text ] [↑][↓] [Remove]  │ │
│ │ ⠿ 3  Hills Like White Elephants          [explanation ↗] [↑][↓] [Remove]  │ │
│ │ ⠿ 4  Big Two-Hearted River               [pasted text ] [↑][↓] [Remove]  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ── Add an article ───────────────────────────────────────────────────────────│
│  ( ◉ Search existing )  ( ○ Paste text )                                      │
│  🔎 [ search explanations…          ]   ▸ pick → [ Add ]                       │
│  (paste mode) ┌──────────────────────┐                                        │
│               │ paste article text…  │  Title:[ optional ]  [ Add ]           │
│               └──────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### W5 — Create / Edit dialog
```
┌ New Style Fingerprint ───────────────────────────┐
│ Name *      [ hemingway_terse           ]         │
│   (letters/digits/_/- ; no spaces or brackets)    │
│ Description [ Terse Hemingway voice      ]         │
│ ── articles are added on the detail page after    │
│    creation; first save creates an empty set ──   │
│                      [ Cancel ]  [ Create ]       │
└───────────────────────────────────────────────────┘
```

### W6 — Strategy config (opt-in surface, existing strategy form)
```
Strategy ▸ Edit ▸ Style enforcement
  ☑ Enable style fingerprint        styleFingerprintEnabled
  Fingerprint: [ hemingway_terse ▼ ]  styleFingerprintId
  (when enabled, each run snapshots this fingerprint and injects it
   into generation + the stylistic_accuracy judge dimension)
```

---

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/setup/extractStyleFingerprint.test.ts` — mock `EvolutionLLMClient`; asserts structured-output parse, multi-article concatenation, anti-overuse directive present in prompt.
- [ ] `evolution/src/lib/pipeline/setup/renderFingerprintProse.test.ts` — deterministic prose from traits; signature phrases rendered as "use sparingly".
- [ ] `evolution/src/lib/pipeline/loop/buildPrompts.test.ts` — `buildEvolutionPrompt` injects `## Target Style` only when `styleGuide` provided; unchanged when absent.
- [ ] `evolution/src/lib/core/entities/StyleFingerprintEntity.test.ts` — entity config, columns, actions, insertSchema wiring.
- [ ] `evolution/src/lib/schemas.test.ts` (extend) — name regex rejects brackets/spaces; junction CHECK (exactly-one-source) at the Zod layer; strategy config flags parse.
- [ ] `evolution/src/services/styleFingerprintActions.test.ts` — create/add/remove/reorder call recompute; `article_count` maintained.

### Integration Tests
- [ ] `src/__tests__/integration/style-fingerprint-actions.integration.test.ts` — real DB CRUD against `evolution_style_fingerprints` + junction; add-article triggers recompute (mock LLM); soft-delete; archived filter; `is_test_content` trigger flags TESTEVO-named rows. Auto-skip when evolution tables not migrated (existing pattern).
- [ ] `src/__tests__/integration/style-fingerprint-run-binding.integration.test.ts` — strategy opt-in → run start writes `style_fingerprint_id` + snapshot; later fingerprint edit does NOT mutate the snapshot.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-style-fingerprints.spec.ts` (`{ tag: '@evolution' }`): nav entry visible → list → create → open detail → add article (search + paste) → reorder → remove → re-extract; uses `evolution-test-data-factory` (name pattern `TESTEVO-style-<ms>-…` so brackets are avoided and the test-content trigger flags it), `resetFilters()` after navigation, and `adminTest.afterAll` cleanup of created fingerprints + junction rows.

### Manual Verification
- [ ] Author a fingerprint over 2–3 real articles; eyeball the rendered prose for accuracy (sentence length, spelling region, signature phrases captured, not over-listed).
- [ ] Run a strategy with `styleFingerprintEnabled` vs a control run; spot-check that generated variants visibly track the target voice and don't overuse signature phrases (acceptance = human spot-check per decision).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-style-fingerprints.spec.ts` on the local tmux server (via ensure-server.sh).
- [ ] Manual: confirm `🎨 Style Fingerprints` appears in the evolution sidebar Entities group and routes correctly.

### B) Automated Tests
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test -- styleFingerprint` (unit)
- [ ] `npm run test:integration -- style-fingerprint`
- [ ] `npm run migration:verify` (migrations touched)
- [ ] `/finalize` check trio (lint+tsc+build+unit+ESM+integration+E2E critical/evolution)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] evolution/docs/data_model.md — new `evolution_style_fingerprints` + junction tables, run snapshot columns
- [ ] evolution/docs/architecture.md — where fingerprint resolution/snapshot sits in run setup
- [ ] evolution/docs/strategies_and_experiments.md — `styleFingerprintEnabled`/`styleFingerprintId` config
- [ ] evolution/docs/editing_agents.md — fingerprint-aware generation directive
- [ ] evolution/docs/criteria_agents.md — `stylistic_accuracy` criterion
- [ ] evolution/docs/rating_and_comparison.md — target-style context in the rubric judge
- [ ] evolution/docs/reference.md — new entity, files, actions, AgentName
- [ ] docs/feature_deep_dives/judge_evaluation.md — style dimension in judge rubric
- [ ] **NEW** docs/feature_deep_dives/style_fingerprint.md — entity overview, extraction, injection, admin UI (+ add to `.claude/doc-mapping.json` for `evolution/src/**/*styleFingerprint*` / `style-fingerprints/**`)
- [ ] docs/feature_deep_dives/admin_panel.md — new registry page + Hide-test behavior

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
