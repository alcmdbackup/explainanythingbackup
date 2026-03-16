// Shared utilities for evolution service actions.

import type { ErrorResponse } from '@/lib/errorHandling';

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
