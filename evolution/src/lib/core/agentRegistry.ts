// Agent class registry: provides access to agent instances for metric merging.
// Static imports so the concrete classes are bound at module load — a dynamic
// require inside the accessor would latch whatever jest.mock happened to be in
// scope at first call (B054).

import type { Agent } from './Agent';
import type { ExecutionDetailBase } from '../types';
import { GenerateFromPreviousArticleAgent } from './agents/generateFromPreviousArticle';
import { ReflectAndGenerateFromPreviousArticleAgent } from './agents/reflectAndGenerateFromPreviousArticle';
import { SwissRankingAgent } from './agents/SwissRankingAgent';
import { MergeRatingsAgent } from './agents/MergeRatingsAgent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<any, any, ExecutionDetailBase>;

let _agents: AnyAgent[] | null = null;

/** Lazily instantiate concrete agent instances (classes themselves are bound at import time). */
export function getAgentClasses(): AnyAgent[] {
  if (!_agents) {
    _agents = [
      new GenerateFromPreviousArticleAgent(),
      new ReflectAndGenerateFromPreviousArticleAgent(),
      new SwissRankingAgent(),
      new MergeRatingsAgent(),
    ];
  }
  return _agents;
}

export function _resetAgentRegistryForTesting(): void {
  _agents = null;
}
