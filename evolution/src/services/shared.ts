// Shared utilities for evolution service actions (test content filtering, UUID validation).

import type { ErrorResponse } from '@/lib/errorHandling';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Canonical action result shape (Shape A: required fields, ErrorResponse error). */
export type ActionResult<T> = {
  success: boolean;
  data: T | null;
  error: ErrorResponse | null;
};

/** Loose UUID regex (any version). */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict v4 UUID regex (version 4, variant 1). */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate a UUID string. Returns true if valid. */
export function validateUuid(id: string, strict = false): boolean {
  return strict ? UUID_V4_REGEX.test(id) : UUID_REGEX.test(id);
}

/** Timestamp pattern for auto-generated test names: a 10-13 digit epoch HYPHEN-delimited
 *  on both sides (e.g. `nav2-1774498767678-strat`, `e2e-nav-1775877428914-strategy`).
 *  Deliberately NOT broadened to space/underscore/trailing delimiters: a space-delimited
 *  epoch like `Gate verify real 1782140234529_7fe0bd` is structurally identical to a
 *  legitimate auto-suffixed name like `Real Prompt 1781926024392_a9sxoe`, so matching it
 *  over-flags real content. The `[TESTEVO]` canary names (the actual high-volume leak) are
 *  caught by the bracket rule below regardless of their timestamp. */
const TIMESTAMP_NAME_PATTERN = /^.*-\d{10,13}-.*$/;

/** Check if a name matches test content patterns (display-only echo of the DB-side
 *  evolution_is_test_name() function; that function is the canonical source of truth —
 *  its value is persisted in evolution_strategies.is_test_content via a BEFORE trigger). */
export function isTestContentName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === 'test' ||
    lower.includes('[test]') ||
    lower.includes('[e2e]') ||
    lower.includes('[test_evo]') ||
    lower.includes('[testevo]') ||
    TIMESTAMP_NAME_PATTERN.test(name)
  );
}

/** Shared anti-drift fixtures for the TS helper + Postgres function.
 *  Integration test at src/__tests__/integration/evolution-is-test-content-backfill.integration.test.ts
 *  verifies both code paths (TS + the `evolution_is_test_name` Postgres function) match this table. */
export const TEST_NAME_FIXTURES: Array<{ name: string; isTest: boolean; reason: string }> = [
  { name: 'test', isTest: true, reason: 'exact lowercase' },
  { name: 'TEST', isTest: true, reason: 'exact uppercase' },
  { name: 'Test', isTest: true, reason: 'exact mixed' },
  { name: '[TEST] Budget Run Strategy 1776204667937', isTest: true, reason: 'bracketed TEST' },
  { name: '[E2E] Anchor Strategy 1775049144246', isTest: true, reason: 'bracketed E2E' },
  { name: '[TEST_EVO] Buffer Display Test', isTest: true, reason: 'bracketed TEST_EVO' },
  { name: '[TESTEVO]-FR3-canary-B2-4d-fixed-1781925811184', isTest: true, reason: 'bracketed TESTEVO (no underscore)' },
  { name: '[TESTEVO] no timestamp', isTest: true, reason: 'bracketed TESTEVO without trailing timestamp' },
  { name: 'e2e-nav-1775877428914-strategy', isTest: true, reason: 'timestamp pattern (hyphen-delimited)' },
  { name: 'my-app-1234567890-prod', isTest: true, reason: 'timestamp pattern 10 digits' },
  { name: 'my-app-1234567890123-prod', isTest: true, reason: 'timestamp pattern 13 digits' },
  // Space/underscore-delimited and trailing epochs are intentionally NOT matched (only
  // [TESTEVO] bracketed names are), to avoid over-flagging legitimate auto-suffixed names:
  { name: 'Real Prompt 1781926024392_a9sxoe', isTest: false, reason: 'space-before epoch in a real name — NOT test content' },
  { name: 'Gate verify real 1782140234529_7fe0bd', isTest: false, reason: 'space-before epoch — structurally identical to a real name, not flagged' },
  { name: 'Cheap judge, aggressive budget floor', isTest: false, reason: 'normal name' },
  { name: 'Qwen 2.5 7b judge', isTest: false, reason: 'normal name with version numbers' },
  { name: 'Renamed Strategy', isTest: false, reason: 'normal name' },
  { name: 'Federal Reserve 2', isTest: false, reason: 'normal name with a short trailing number' },
  { name: 'Nightly smoke fixture', isTest: false, reason: 'operational fixture, intentionally visible (no timestamp/marker)' },
  { name: '', isTest: false, reason: 'empty string' },
  { name: 'contestant', isTest: false, reason: 'contains test substring but not exact' },
];

/**
 * Fetch IDs of strategies flagged as test content via the `is_test_content` column
 * (populated by the `evolution_is_test_name` Postgres function + trigger). Replaces the
 * legacy two-step fetch + JS regex dance that diverged from the DB function on the
 * timestamp-pattern case.
 */
export async function getTestStrategyIds(supabase: SupabaseClient): Promise<string[]> {
  const { data: strategies } = await supabase
    .from('evolution_strategies')
    .select('id')
    .eq('is_test_content', true);

  return (strategies ?? []).map((s) => s.id as string);
}

/**
 * Apply a test-content exclusion filter via PostgREST embedded-resource !inner join.
 * For queries on tables that FK to evolution_strategies (evolution_runs,
 * evolution_agent_invocations, and indirectly evolution_variants through runs).
 *
 * Usage:
 *   let query = supabase.from('evolution_runs').select('<your fields>', { count: 'exact' });
 *   if (filterTestContent) query = applyNonTestStrategyFilter(query);
 *
 * The !inner modifier is REQUIRED — without it, rows whose embed is filtered out still
 * appear in the parent resultset (just with null embed). The !inner moves the filter
 * into an INNER JOIN on the embedded resource, which correctly drops parent rows.
 *
 * Prerequisite migration: 20260325000001_drop_duplicate_strategy_fk.sql (removes the
 * duplicate FK that previously caused PGRST201 on this join).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are too deeply nested
export function applyNonTestStrategyFilter(query: any): any {
  return query.eq('evolution_strategies.is_test_content', false);
}

/**
 * Exclude rows where the persisted `is_test_content` boolean column is true.
 * For tables that have the column (set to true by a BEFORE trigger calling
 * `evolution_is_test_name(name)`):
 *   - `evolution_strategies` (since migration 20260415000001)
 *   - `evolution_prompts` (since migration 20260423000001)
 *   - `evolution_experiments` (since migration 20260423000001)
 *
 * Equivalent to `applyTestContentNameFilter` but uses the persisted boolean
 * (catches the timestamp-pattern names like `e2e-nav-1775877428914-strategy`
 * that the substring-only filter missed) and is cheap because the partial
 * indexes `idx_*_non_test` cover this exact predicate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are too deeply nested
export function applyTestContentColumnFilter(query: any): any {
  return query.eq('is_test_content', false);
}

/**
 * Exclude rows where name matches test patterns via substring matches.
 *
 * @deprecated Prefer `applyTestContentColumnFilter` for tables that have the
 * `is_test_content` column. This substring-only filter MISSES the
 * timestamp-pattern test names (`<word>-<10-13 digits>-<word>`) — that
 * pattern is part of `evolution_is_test_name()` (the canonical predicate)
 * but was never represented in this filter, which is why test rows like
 * `e2e-nav-1775877428914-strategy` leaked through.
 *
 * Kept around for any caller that targets a table without the column. New
 * code should add the column + trigger and use `applyTestContentColumnFilter`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are too deeply nested
export function applyTestContentNameFilter(query: any): any {
  return query
    .not('name', 'ilike', '%[TEST]%')
    .not('name', 'ilike', '%[E2E]%')
    .not('name', 'ilike', '%[TEST_EVO]%')
    .not('name', 'ilike', 'test');
}
