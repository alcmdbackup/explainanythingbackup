# Style Fingerprint

A **style fingerprint** is a DB-first, user-authored description of a writer's style, computed over a SET of source articles and enforceable on evolution article generation. It is injected into generation prompts (to steer voice) and into the judging rubric (to score stylistic accuracy). Evolution-pipeline only; the main app is out of scope.

Project: `docs/planning/generate_enforce_style_fingerprint_evolution_20260620/`.

## Overview

- A fingerprint is a first-class entity (mirrors `evolution_criteria` / `evolution_prompts`): own table, CRUD via the admin UI, soft-delete via `deleted_at`, `is_test_content` auto-classified by a BEFORE trigger.
- It is computed over **one or more articles** (a "set"), each either an existing `explanations` row (by id) OR pasted text. Adding/removing an article **fully recomputes** the fingerprint over the enlarged/reduced set.
- A strategy **opts in** per-strategy (`styleFingerprintEnabled` + `styleFingerprintId`). At run start the run **snapshots** the fingerprint (`evolution_runs.style_fingerprint_snapshot`) so later edits never change what historical runs were generated/judged against.

## Data model

| Table | Purpose |
|---|---|
| `evolution_style_fingerprints` | The entity: `name` (constraint-legal slug), `description`, `fingerprint` JSONB (structured traits), `fingerprint_prose` TEXT (rendered article-scope prose), `article_count`, `status`, soft-delete cols. |
| `evolution_style_fingerprint_articles` | Junction: each row is EITHER `explanation_id` (BIGINT FK) OR `article_text` (exactly one, non-empty — CHECK). `position` orders the set. |
| `evolution_runs.style_fingerprint_id` + `style_fingerprint_snapshot` | Per-run reference + immutable JSONB snapshot (no FK — run survives fingerprint hard-delete). |

Migration: `supabase/migrations/20260621000001_create_evolution_style_fingerprints.sql` (also seeds the `stylistic_accuracy` criterion and extends `evolution_metrics.entity_type`).

## Key files

| Concern | File |
|---|---|
| Entity class | `evolution/src/lib/core/entities/StyleFingerprintEntity.ts` (soft-delete `executeAction('delete')` override) |
| CRUD + article ops | `evolution/src/services/styleFingerprintActions.ts` |
| Extraction | `evolution/src/lib/pipeline/setup/extractStyleFingerprint.ts` (uses `callLLM`, parse + repair) |
| Prose render | `evolution/src/lib/pipeline/setup/renderFingerprintProse.ts` (`'article'` vs `'paragraph'` scope) |
| Run resolution + snapshot | `evolution/src/lib/pipeline/setup/buildRunContext.ts` |
| Generation injection (article) | `evolution/src/lib/pipeline/loop/buildPrompts.ts` (`styleGuide`), `generateFromPreviousArticle.ts` |
| Generation injection (paragraph) | `buildParagraphRewritePrompt.ts`, `buildSequentialRewritePrompt.ts`, `ParagraphRecombineAgent.ts`, `sequentialExecute.ts` |
| Judging injection | `evolution/src/lib/shared/rubricJudge.ts` (`targetStyleProse`), threaded via `computeRatings.ts` from `rankSingleVariant.ts` + `SwissRankingAgent.ts` |
| Admin UI | `src/app/admin/evolution/style-fingerprints/` (list + `[styleFingerprintId]` detail) |
| Strategy opt-in | `src/app/admin/evolution/strategies/new/page.tsx` |

## Extraction

`extractStyleFingerprint(articles, callFn)` makes ONE structured LLM call over the concatenated set (article bodies wrapped in untrusted-data delimiters), parsing with `JSON.parse` → Zod `safeParse` → a single repair retry → typed `StyleExtractionError`. It runs at CRUD time (no run), so it uses `callLLM` (the standalone path `runJudgeEval` uses), NOT `EvolutionLLMClient.complete` (which needs a run/costTracker). Cost is accumulated into the fingerprint-level `total_extraction_cost` metric.

The set-mutating actions use **compute-first / persist-last**: resolve the resulting set, run extraction, and only persist the junction change + fingerprint together on success — so the set and fingerprint never diverge on an LLM failure.

## Injection

**Generation.** `buildEvolutionPrompt` gains an optional `styleGuide` (options bag) that renders a `## Target Style` block; agents read `ctx.styleFingerprint?.prose`. Paragraph rewrites render the **paragraph-shaped** prose (drops the cross-piece anti-overuse directive — a single paragraph naturally won't contain most signature phrases). Output is byte-identical when no fingerprint is referenced.

**Judging.** `buildRubricComparisonPrompt` gains an optional `targetStyleProse` rendering a `## Target Style` block (both `article` and `paragraph` modes — it is a single chokepoint). The prose is carried on `EvolutionConfig.styleFingerprint` (`{prose, traits}`) and read at the ranking call sites (`rankSingleVariant`, `SwissRankingAgent`), which render the **mode-shaped** prose from `traits` — so paragraph judging never inherits the article-shaped prose. The seeded `stylistic_accuracy` criterion can be attached to a strategy's `judgeRubricId` (article) and/or `paragraphJudgeRubricId` (paragraph) bundle. Respects the existing `EVOLUTION_RUBRIC_JUDGING_ENABLED` kill switch.

## Rollback / no-op

Default off per-strategy (`styleFingerprintEnabled=false` ⇒ NULL `style_fingerprint_id` ⇒ no-op; generation + judging byte-identical). Judging additionally honors `EVOLUTION_RUBRIC_JUDGING_ENABLED`. The tables are additive; in-flight runs read their immutable snapshot.
