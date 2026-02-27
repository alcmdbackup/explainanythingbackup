# Article Detail View & Elo Attribution

Cross-run article detail page, variant detail deep-dive, and creator-based Elo attribution that credits creating agents instead of ranking agents.

## Problem

Two problems motivated this feature:

1. **Attribution mismatch**: The evolution pipeline credited ranking agents (CalibrationRanker, Tournament) for Elo changes instead of creating agents (GenerationAgent, IterativeEditing, etc.), making strategy evaluation impossible. An agent that wrote brilliant text got no credit — only the judge that scored it.

2. **No article-level view**: All existing views were run-scoped. There was no page that aggregated an article's full evolution history across runs, and no page for variant deep-dives.

## Architecture

### Creator-Based Elo Attribution

**Core idea**: Measure how much a variant's rating differs from its parent(s), credit that delta to the creating agent.

```
Per-variant:
  deltaMu = variant.mu - avg(parent.mu)
  sigmaDelta = sqrt(variant.sigma² + avg(parent.sigma²))
  gain = deltaMu * ELO_SCALE    (ELO_SCALE = 400/25 = 16)
  ci = 1.96 * sigmaDelta * ELO_SCALE
  zScore = deltaMu / sigmaDelta

Per-agent (aggregated):
  totalGain = sum(variant gains)
  avgGain = mean(variant gains)
  avgCi = sqrt(sum(ci²)) / N    (root-sum-of-squares preserves uncertainty)
```

**Key files:**
- `evolution/src/lib/core/eloAttribution.ts` — `computeEloAttribution`, `aggregateByAgent`
- `evolution/src/lib/core/persistence.ts` — `computeAndPersistAttribution()` called at pipeline finalization
- `evolution/src/components/evolution/AttributionBadge.tsx` — Visual badge with z-score color coding

**Z-score thresholds:**
- |z| < 1.0 → grey (noise)
- 1.0 ≤ |z| < 2.0 → amber (suggestive)
- |z| ≥ 2.0 → green/red (statistically significant)

### Article Detail Page

**Route**: `/admin/quality/evolution/article/[explanationId]`

Server component that aggregates all evolution runs for a single explanation. Three tabs:

| Tab | Component | Data Action |
|-----|-----------|-------------|
| Runs | `ArticleRunsTimeline` | `getArticleRunsAction` |
| Attribution | `ArticleAgentAttribution` | `getArticleAgentAttributionAction` |
| Variants | `ArticleVariantsList` | `getArticleVariantsAction` |

The overview card (`ArticleOverviewCard`) shows explanation metadata, total runs, best Elo, and HoF standing.

### Variant Detail Page

**Route**: `/admin/quality/evolution/variant/[variantId]`

Server component that provides a deep-dive into a single variant. Sections:

| Section | Component | Data Action |
|---------|-----------|-------------|
| Overview | `VariantOverviewCard` | `getVariantFullDetailAction` |
| Content | `VariantContentSection` | (data from overview) |
| Lineage | `VariantLineageSection` | `getVariantParentsAction`, `getVariantChildrenAction` |
| Matches | `VariantMatchHistory` | `getVariantMatchHistoryAction` |

Breadcrumb chain: Evolution > Article > Run > Variant (bidirectional navigation).

### Bidirectional Navigation

Links were added in both directions across all evolution pages:

| From | To | Link Type |
|------|----|-----------|
| RunsTable | Article detail | ↗ icon next to explanation ID |
| Run detail header | Article detail | "Article History" button |
| VariantsTab row | Variant detail | "Full" link |
| VariantDetailPanel parents/opponents | Variant detail | ShortId href |
| LineageTab node detail | Variant detail | ShortId href |
| Hall of Fame leaderboard | Article detail | ⧉ icon |
| Variant detail | Article detail | Breadcrumb + "Article History" link |
| Article detail runs tab | Run detail | Run card links |

## Key Files

### Pages
- `src/app/admin/quality/evolution/article/[explanationId]/page.tsx`
- `src/app/admin/quality/evolution/article/[explanationId]/ArticleDetailTabs.tsx`
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx`

### Components (`evolution/src/components/evolution/`)
- `AttributionBadge.tsx` — Shared attribution badge + agent summary
- `article/ArticleOverviewCard.tsx`
- `article/ArticleRunsTimeline.tsx`
- `article/ArticleAgentAttribution.tsx`
- `article/ArticleVariantsList.tsx`
- `variant/VariantOverviewCard.tsx`
- `variant/VariantContentSection.tsx`
- `variant/VariantLineageSection.tsx`
- `variant/VariantMatchHistory.tsx`

### Server Actions
- `evolution/src/services/articleDetailActions.ts` — 5 actions
- `evolution/src/services/variantDetailActions.ts` — 4 actions

### Core
- `evolution/src/lib/core/eloAttribution.ts` — Attribution math
- `evolution/src/lib/core/persistence.ts` — `computeAndPersistAttribution()`
- `evolution/src/lib/utils/evolutionUrls.ts` — `buildArticleUrl`, `buildVariantDetailUrl`

### Database Migrations
- `supabase/migrations/20260226000001_elo_attribution_columns.sql` — JSONB columns
- `supabase/migrations/20260226000002_elo_attribution_index.sql` — CONCURRENTLY index

## Testing

### Unit Tests
- `evolution/src/lib/core/eloAttribution.test.ts` — 13 tests (attribution math, edge cases)
- `evolution/src/components/evolution/AttributionBadge.test.tsx` — 10 tests (z-score colors, display)
- `evolution/src/services/articleDetailActions.test.ts` — Mock chain tests
- `evolution/src/services/variantDetailActions.test.ts` — Mock chain tests
- `evolution/src/lib/core/persistence.test.ts` — Attribution persistence tests

### E2E Tests
- `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts` — 9 tests (skip-gated until DB migration)

## Related Documentation

- [Visualization](../../evolution/docs/evolution/visualization.md) — Dashboard and per-run views
- [Data Model](../../evolution/docs/evolution/data_model.md) — Core primitives, elo_attribution column
- [Rating & Comparison](../../evolution/docs/evolution/rating_and_comparison.md) — Creator-based attribution math
- [Reference](../../evolution/docs/evolution/reference.md) — Key files, migrations, testing
