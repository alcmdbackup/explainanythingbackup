// Abstract base class for all evolution pipeline agents.
// Defines the execution interface and result types for agent implementations.

import type { AgentResult, ExecutionContext, PipelineState, AgentPayload } from '../types';

export abstract class AgentBase {
  abstract readonly name: string;

  /** Execute the agent's primary function. */
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;

  /** Estimate cost in USD for executing with the given payload. */
  abstract estimateCost(payload: AgentPayload): number;

  /** Check if the agent can execute given current state. */
  abstract canExecute(state: PipelineState): boolean;
}
