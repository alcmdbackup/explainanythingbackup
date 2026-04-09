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

/** Timestamp pattern for auto-generated test names (e.g., "nav2-1774498767678-strat"). */
const TIMESTAMP_NAME_PATTERN = /^.*-\d{10,13}-.*$/;

/** Check if a name matches test content patterns. */
export function isTestContentName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === 'test' ||
    lower.includes('[test]') ||
    lower.includes('[e2e]') ||
    lower.includes('[test_evo]') ||
    TIMESTAMP_NAME_PATTERN.test(name)
  );
}

/**
 * Fetch IDs of strategies whose names match test content patterns.
 * Used by actions that filter runs/invocations by strategy_id.
 */
export async function getTestStrategyIds(supabase: SupabaseClient): Promise<string[]> {
  const { data: strategies } = await supabase
    .from('evolution_strategies')
    .select('id, name')
    .or('name.ilike.%[TEST]%,name.ilike.%[E2E]%,name.ilike.%[TEST_EVO]%,name.ilike.test');

  return (strategies ?? [])
    .filter((s): s is { id: string; name: string } => isTestContentName(s.name))
    .map(s => s.id);
}

/**
 * Exclude rows where name matches test patterns.
 * For use on tables with a 'name' column (strategies, experiments, arena).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are too deeply nested
export function applyTestContentNameFilter(query: any): any {
  return query
    .not('name', 'ilike', '%[TEST]%')
    .not('name', 'ilike', '%[E2E]%')
    .not('name', 'ilike', '%[TEST_EVO]%')
    .not('name', 'ilike', 'test');
}
