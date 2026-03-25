// Generation agent: wraps generateVariants() with invocation/cost/budget ceremony.

import { Agent } from '../Agent';
import type { AgentContext } from '../types';
import type { Variant } from '../../types';
import type { EvolutionLLMClient } from '../../types';
import { generateVariants } from '../../pipeline/loop/generateVariants';
import { generationExecutionDetailSchema } from '../../schemas';

export interface GenerationInput {
  text: string;
  llm: EvolutionLLMClient;
  feedback?: { weakestDimension: string; suggestions: string[] };
}

export class GenerationAgent extends Agent<GenerationInput, Variant[]> {
  readonly name = 'generation';
  readonly executionDetailSchema = generationExecutionDetailSchema;

  async execute(input: GenerationInput, ctx: AgentContext): Promise<Variant[]> {
    return generateVariants(
      input.text, ctx.iteration, input.llm, ctx.config, input.feedback, ctx.logger,
    );
  }
}
