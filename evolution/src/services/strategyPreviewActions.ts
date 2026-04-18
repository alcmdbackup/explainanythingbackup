// Server actions for strategy creation UI previews — pure wrappers around pipeline
// estimation helpers. Kept separate from costAnalytics.ts (which is DB-backed admin
// analytics) because these actions are pure and only need admin auth + input validation.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { estimateAgentCost } from '../lib/pipeline/infra/estimateCosts';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';

// ─── Schemas ────────────────────────────────────────────────────

/** Representative defaults used by the preview — see returned `assumptions` for values.
 *  We assume a fixed 15 ranking comparisons per agent rather than deriving from
 *  pool size / numVariants. Rationale: actual comparisons per agent vary by
 *  dispatch stage (first parallel agent sees pool=1 → 0 comparisons; later
 *  sequential agents see a growing pool). A flat representative number keeps
 *  the preview stable and predictable for budget planning. */
const REPRESENTATIVE_SEED_CHARS = 5000;
const REPRESENTATIVE_STRATEGY = 'grounding_enhance'; // Most expensive of 3 core strategies
const REPRESENTATIVE_COMPARISONS = 15;

const previewInputSchema = z.object({
  generationModel: allowedLLMModelSchema,
  judgeModel: allowedLLMModelSchema,
  /** Override the representative seed article size. Defaults to 5000 chars. */
  seedArticleChars: z.number().int().min(100).max(100000).optional(),
});

export interface AgentCostPreview {
  estimatedAgentCostUsd: number;
  assumptions: {
    seedArticleChars: number;
    tactic: string;
    /** Representative ranking comparisons per agent used by the preview. */
    comparisonsUsed: number;
  };
}

// ─── Action ─────────────────────────────────────────────────────

/** Preview the estimated cost of one generateFromPreviousArticle agent for the given
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
    // To force `estimateAgentCost` to use exactly REPRESENTATIVE_COMPARISONS comparisons,
    // pass poolSize = REPRESENTATIVE_COMPARISONS + 1 (so poolSize - 1 = 15) and cap at 15.
    // The internal logic is `min(poolSize - 1, maxComparisonsPerVariant)`.
    const poolSizeForEstimate = REPRESENTATIVE_COMPARISONS + 1;

    const estimatedAgentCostUsd = estimateAgentCost(
      seedArticleChars,
      REPRESENTATIVE_STRATEGY,
      parsed.generationModel,
      parsed.judgeModel,
      poolSizeForEstimate,
      REPRESENTATIVE_COMPARISONS,
    );

    return {
      estimatedAgentCostUsd,
      assumptions: {
        seedArticleChars,
        tactic: REPRESENTATIVE_STRATEGY,
        comparisonsUsed: REPRESENTATIVE_COMPARISONS,
      },
    };
  },
);
