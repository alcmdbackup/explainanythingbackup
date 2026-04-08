// Agent class registry: provides access to agent instances for metric merging.
// Uses lazy instantiation to avoid circular dependency issues with entity registry.

import type { Agent } from './Agent';
import type { ExecutionDetailBase } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<any, any, ExecutionDetailBase>;

let _agents: AnyAgent[] | null = null;

/** Lazily initialize and return all concrete agent class instances. */
export function getAgentClasses(): AnyAgent[] {
  if (!_agents) {
    // Dynamic requires avoid circular deps at module load time
    const { GenerateFromSeedArticleAgent } = require('./agents/generateFromSeedArticle');
    const { SwissRankingAgent } = require('./agents/SwissRankingAgent');
    const { MergeRatingsAgent } = require('./agents/MergeRatingsAgent');
    _agents = [
      new GenerateFromSeedArticleAgent(),
      new SwissRankingAgent(),
      new MergeRatingsAgent(),
    ];
  }
  return _agents;
}

export function _resetAgentRegistryForTesting(): void {
  _agents = null;
}
