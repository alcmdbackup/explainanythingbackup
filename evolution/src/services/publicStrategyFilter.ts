// Shared filter for public /edit strategy submissibility.
// Single source of truth for the filter shape used by both listPublicStrategiesAction
// (JS-side filter after DB fetch) and submitPublicEditAction (per-strategy assert).
// See improvements_to_edit_page_evolution_20260630 Phase 1.

import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

/** Model names that indicate a mock/test strategy. Never surfaced on the public picker. */
export const MOCK_MODEL_NAMES: ReadonlySet<string> = new Set(['mock', 'test-mock']);

/** Reasons a strategy is NOT publicly submittable, exposed on NotPubliclySubmittableError.code. */
export type NotPubliclySubmittableCode =
  | 'STATUS'          // not status='active'
  | 'TEST_CONTENT'    // is_test_content=true
  | 'MOCK_MODEL'      // config.generationModel is in MOCK_MODEL_NAMES (or missing)
  | 'PUBLIC_VISIBLE'; // PUBLIC_EDIT_WIDEN_FILTER='false' and public_visible!=true

export class NotPubliclySubmittableError extends Error {
  code: NotPubliclySubmittableCode;
  constructor(code: NotPubliclySubmittableCode, msg: string) {
    super(msg);
    this.code = code;
    this.name = 'NotPubliclySubmittableError';
  }
}

/** Minimal row shape both call sites can pass. Additional fields on the passed
 *  row are ignored — this type only names the fields the filter reads. */
export interface StrategyRow {
  status: string;
  is_test_content: boolean;
  /** May be `null` when the DB column is nullable — treated as "not public". */
  public_visible?: boolean | null;
  config?: Partial<StrategyConfig> | null;
}

/** Per-invocation env read (NOT module-scope) so integration tests can toggle. */
function isWidenedFilterEnabled(): boolean {
  return process.env.PUBLIC_EDIT_WIDEN_FILTER === 'true';
}

/** Throws NotPubliclySubmittableError with a specific code on rejection.
 *  Both listPublicStrategiesAction (post-fetch filter) and submitPublicEditAction
 *  (per-strategy check at submit time) call this to stay in lockstep. */
export function assertStrategyPubliclySubmittable(row: StrategyRow): void {
  if (row.status !== 'active') {
    throw new NotPubliclySubmittableError('STATUS', 'Strategy is not active');
  }
  if (row.is_test_content) {
    throw new NotPubliclySubmittableError('TEST_CONTENT', 'Strategy is test content');
  }
  const generationModel = row.config?.generationModel;
  if (!generationModel || MOCK_MODEL_NAMES.has(generationModel)) {
    throw new NotPubliclySubmittableError('MOCK_MODEL', 'Strategy uses a mock generation model');
  }
  if (!isWidenedFilterEnabled()) {
    // Legacy filter: additionally require public_visible=true
    if (row.public_visible !== true) {
      throw new NotPubliclySubmittableError('PUBLIC_VISIBLE', 'Strategy is not marked publicVisible');
    }
  }
}

/** Convenience: return only submittable rows. Used by listPublicStrategiesAction.
 *  Accepts a wider row shape than StrategyRow — only the filter-relevant fields
 *  are read; other fields pass through. */
export function filterPubliclySubmittable<T extends StrategyRow>(rows: T[]): T[] {
  return rows.filter((row: T): boolean => {
    try {
      assertStrategyPubliclySubmittable(row as StrategyRow);
      return true;
    } catch {
      return false;
    }
  });
}
