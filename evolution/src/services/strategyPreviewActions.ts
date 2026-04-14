// Server actions for strategy creation UI previews — pure wrappers around pipeline
// estimation helpers. Kept separate from costAnalytics.ts (which is DB-backed admin
// analytics) because these actions are pure and only need admin auth + input validation.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { estimateAgentCost } from '../lib/pipeline/infra/estimateCosts';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';

// ─── Schemas ────────────────────────────────────────────────────

/** Representative defaults used by the preview — see returned `assumptions` for values. */
const REPRESENTATIVE_SEED_CHARS = 5000;
const REPRESENTATIVE_STRATEGY = 'grounding_enhance'; // Most expensive of 3 core strategies
const REPRESENTATIVE_POOL_SIZE = 1;                 // Only baseline at parallel dispatch time

const previewInputSchema = z.object({
  generationModel: allowedLLMModelSchema,
  judgeModel: allowedLLMModelSchema,
  maxComparisonsPerVariant: z.number().int().min(1).max(50).optional(),
  seedArticleChars: z.number().int().min(100).max(100000).optional(),
});

export interface AgentCostPreview {
  estimatedAgentCostUsd: number;
  assumptions: {
    seedArticleChars: number;
    strategy: string;
    poolSize: number;
    maxComparisonsPerVariant: number;
  };
}

// ─── Action ─────────────────────────────────────────────────────

/** Preview the estimated cost of one generateFromSeedArticle agent for the given
 *  strategy config. Used by the strategy creation form to show the USD equivalent
 *  when a user specifies budget floors in "Multiple of agent cost" mode. */
export const estimateAgentCostPreviewAction = adminAction(
  'estimateAgentCostPreview',
  // The second `_ctx` param is REQUIRED for adminAction's arity detection —
  // a 1-arg handler is treated as ctx-only, causing client input to be passed
  // as ctx and Zod parsing to fail silently.
  async (
    input: z.input<typeof previewInputSchema>,
    _ctx: AdminContext,
  ): Promise<AgentCostPreview> => {
    const parsed = previewInputSchema.parse(input);

    const seedArticleChars = parsed.seedArticleChars ?? REPRESENTATIVE_SEED_CHARS;
    const maxComparisonsPerVariant = parsed.maxComparisonsPerVariant ?? 15;

    const estimatedAgentCostUsd = estimateAgentCost(
      seedArticleChars,
      REPRESENTATIVE_STRATEGY,
      parsed.generationModel,
      parsed.judgeModel,
      REPRESENTATIVE_POOL_SIZE,
      maxComparisonsPerVariant,
    );

    return {
      estimatedAgentCostUsd,
      assumptions: {
        seedArticleChars,
        strategy: REPRESENTATIVE_STRATEGY,
        poolSize: REPRESENTATIVE_POOL_SIZE,
        maxComparisonsPerVariant,
      },
    };
  },
);
