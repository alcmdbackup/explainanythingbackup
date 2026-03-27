// Shared utilities for evolution service actions.

import type { ErrorResponse } from '@/lib/errorHandling';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Action result type ──────────────────────────────────────────

/** Canonical action result shape (Shape A: required fields, ErrorResponse error). */
export type ActionResult<T> = {
  success: boolean;
  data: T | null;
  error: ErrorResponse | null;
};

// ─── UUID validation ─────────────────────────────────────────────

/** Loose UUID regex (any version). */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict v4 UUID regex (version 4, variant 1). */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate a UUID string. Returns true if valid. */
export function validateUuid(id: string, strict = false): boolean {
  return strict ? UUID_V4_REGEX.test(id) : UUID_REGEX.test(id);
}

// ─── Test content filtering ─────────────────────────────────────

/** Timestamp pattern for auto-generated test names (e.g., "nav2-1774498767678-strat"). */
const TIMESTAMP_NAME_PATTERN = /^.*-\d{10,13}-.*$/;

/** Check if a name matches test content patterns. */
export function isTestContentName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  // Exact match "test" (case-insensitive)
  if (lower === 'test') return true;
  // [TEST] prefix
  if (lower.includes('[test]')) return true;
  // Timestamp-based auto-generated names
  if (TIMESTAMP_NAME_PATTERN.test(name)) return true;
  return false;
}

/**
 * Fetch IDs of strategies whose names match test content patterns.
 * Used by actions that filter runs/invocations by strategy_id.
 */
export async function getTestStrategyIds(supabase: SupabaseClient): Promise<string[]> {
  // Fetch all strategies with [TEST] in name or exact "test" name
  const { data: strategies } = await supabase
    .from('evolution_strategies')
    .select('id, name')
    .or('name.ilike.%[TEST]%,name.eq.test,name.eq.Test');

  const ids = (strategies ?? [])
    .filter(s => isTestContentName(s.name as string))
    .map(s => s.id as string);

  return ids;
}

/**
 * Apply test content name filter to a direct name column query.
 * Excludes rows where name matches test patterns.
 * For use on tables with a 'name' column (strategies, experiments, arena).
 *
 * eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder types are too deeply nested for generics
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyTestContentNameFilter(query: any): any {
  // Exclude [TEST] prefix and exact "test"/"Test" names
  return query
    .not('name', 'ilike', '%[TEST]%')
    .not('name', 'eq', 'test')
    .not('name', 'eq', 'Test');
}
