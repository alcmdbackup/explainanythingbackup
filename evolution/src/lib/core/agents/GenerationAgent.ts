// Generation agent: wraps generateVariants() with invocation/cost/budget ceremony.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { Variant, GenerationExecutionDetail } from '../../types';
import type { EvolutionLLMClient } from '../../types';
import { generateVariants } from '../../pipeline/loop/generateVariants';
import { generationExecutionDetailSchema } from '../../schemas';
import type { FinalizationContext } from '../../metrics/types';
import { METRIC_CATALOG } from '../metricCatalog';

export interface GenerationInput {
  text: string;
  llm: EvolutionLLMClient;
  feedback?: { weakestDimension: string; suggestions: string[] };
}

export class GenerationAgent extends Agent<GenerationInput, Variant[], GenerationExecutionDetail> {
  readonly name = 'generation';
  readonly executionDetailSchema = generationExecutionDetailSchema;

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.format_rejection_rate,
      compute: (ctx) => GenerationAgent.computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    {
      key: 'strategies', label: 'Strategies', type: 'table',
      columns: [
        { key: 'name', label: 'Strategy' },
        { key: 'status', label: 'Status' },
        { key: 'promptLength', label: 'Prompt Length' },
        { key: 'textLength', label: 'Text Length' },
        { key: 'variantId', label: 'Variant ID' },
      ],
    },
    { key: 'feedbackUsed', label: 'Feedback Used', type: 'boolean' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  private static computeFormatRejectionRate(ctx: FinalizationContext, invocationId: string | null): number | null {
    if (!invocationId || !ctx.invocationDetails) return null;
    const detail = ctx.invocationDetails.get(invocationId) as GenerationExecutionDetail | undefined;
    if (!detail?.strategies?.length) return null;
    return detail.strategies.filter(s => s.status === 'format_rejected').length / detail.strategies.length;
  }

  async execute(input: GenerationInput, ctx: AgentContext): Promise<AgentOutput<Variant[], GenerationExecutionDetail>> {
    const { variants, strategyResults } = await generateVariants(
      input.text, ctx.iteration, input.llm, ctx.config, input.feedback, ctx.logger,
    );

    const detail: GenerationExecutionDetail = {
      detailType: 'generation',
      totalCost: 0, // Patched by Agent.run()
      strategies: strategyResults,
      feedbackUsed: !!input.feedback,
    };

    return {
      result: variants,
      detail,
      childVariantIds: variants.map(v => v.id),
    };
  }
}
