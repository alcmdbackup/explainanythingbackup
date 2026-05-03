// Agent class registry: provides access to agent instances for metric merging.
// Static imports so the concrete classes are bound at module load — a dynamic
// require inside the accessor would latch whatever jest.mock happened to be in
// scope at first call (B054).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Agent } from './Agent';
import type { ExecutionDetailBase } from '../types';
import { GenerateFromPreviousArticleAgent } from './agents/generateFromPreviousArticle';
import { ReflectAndGenerateFromPreviousArticleAgent } from './agents/reflectAndGenerateFromPreviousArticle';
import { IterativeEditingAgent } from './agents/editing/IterativeEditingAgent';
import { EvaluateCriteriaThenGenerateFromPreviousArticleAgent } from './agents/evaluateCriteriaThenGenerateFromPreviousArticle';
import { SwissRankingAgent } from './agents/SwissRankingAgent';
import { MergeRatingsAgent } from './agents/MergeRatingsAgent';
// B003-S3: register CreateSeedArticleAgent so its invocationMetrics merge into
// InvocationEntity at registry init, and so the entities.test.ts parity test
// against DETAIL_VIEW_CONFIGS catches future regressions.
import { CreateSeedArticleAgent } from './agents/createSeedArticle';
import { assertCostCalibrationPhaseEnumsMatch } from './startupAssertions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<any, any, ExecutionDetailBase>;

let _agents: AnyAgent[] | null = null;

/** Lazily instantiate concrete agent instances (classes themselves are bound at import time). */
export function getAgentClasses(): AnyAgent[] {
  if (!_agents) {
    _agents = [
      new GenerateFromPreviousArticleAgent(),
      new ReflectAndGenerateFromPreviousArticleAgent(),
      new IterativeEditingAgent(),
      new EvaluateCriteriaThenGenerateFromPreviousArticleAgent(),
      new SwissRankingAgent(),
      new MergeRatingsAgent(),
      // B003-S3: registered to feed invocationMetrics merge + parity tests.
      new CreateSeedArticleAgent(),
    ];
  }
  return _agents;
}

/** Phase 1.6 deploy-ordering gate. Invoke once at service startup, BEFORE any
 *  code that writes new cost-calibration phase strings runs. Throws
 *  MissingMigrationError if the DB CHECK constraint is missing any TS phase
 *  string (eliminates the silent-reject failure mode PR #1017 hit).
 *
 *  Idempotent: caches positive result for the process lifetime. Fails open on
 *  permission-denied errors so misconfigured local environments don't brick.
 *  Production-only: skipped under NODE_ENV='test' (so unit-test mocks don't
 *  trip the assertion) and NODE_ENV='development' (so dev environments without
 *  the pg_get_constraintdef_by_name RPC installed don't break the API path).
 *  The dedicated startupAssertions.test.ts exercises the assertion directly
 *  with full mocks.
 *
 *  Per bring_back_editing_agents_evolution_20260430 Decisions §18 + Phase 1.6.
 *  Caller passes a Supabase service-role client (the same one
 *  costCalibrationLoader uses). */
export async function ensureStartupAssertions(client: SupabaseClient): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  await assertCostCalibrationPhaseEnumsMatch(client);
}

export function _resetAgentRegistryForTesting(): void {
  _agents = null;
}
