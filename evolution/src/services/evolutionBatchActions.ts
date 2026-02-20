'use server';
// Server action for dispatching parallel evolution batch runs via GitHub Actions workflow.
// Calls the GitHub REST API to trigger the evolution-batch.yml workflow_dispatch event.

import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { handleError, ERROR_CODES, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { serverReadRequestId } from '@/lib/serverReadRequestId';

// ─── Types ───────────────────────────────────────────────────────

export interface DispatchBatchInput {
  parallel: number;
  maxRuns: number;
  dryRun: boolean;
}

export interface DispatchBatchResult {
  success: boolean;
  data: { dispatched: boolean } | null;
  error: ErrorResponse | null;
}

// ─── Dispatch GitHub Actions workflow ────────────────────────────

const _dispatchEvolutionBatchAction = withLogging(async (
  input: DispatchBatchInput
): Promise<DispatchBatchResult> => {
  try {
    await requireAdmin();

    // Validate inputs
    const parallel = Math.max(1, Math.min(10, Math.round(input.parallel)));
    const maxRuns = Math.max(1, Math.min(100, Math.round(input.maxRuns)));

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        success: false,
        data: null,
        error: { code: ERROR_CODES.INVALID_INPUT, message: 'GITHUB_TOKEN not configured. Add a fine-grained PAT with actions:write scope.' },
      };
    }

    const repo = process.env.GITHUB_REPO || 'Minddojo/explainanything';
    const workflowFile = 'evolution-batch.yml';
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`;

    // Use same environment as this deployment so batch uses matching Supabase (and other secrets).
    // EVOLUTION_BATCH_ENVIRONMENT overrides; otherwise VERCEL_ENV (production | preview | development); default production.
    const batchEnvironment =
      process.env.EVOLUTION_BATCH_ENVIRONMENT ||
      process.env.VERCEL_ENV ||
      'production';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          environment: batchEnvironment === 'development' ? 'preview' : batchEnvironment,
          'max-runs': String(maxRuns),
          parallel: String(parallel),
          'dry-run': String(input.dryRun),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        data: null,
        error: { code: ERROR_CODES.UNKNOWN_ERROR, message: `GitHub API error (${response.status}): ${body}` },
      };
    }

    logger.info('Evolution batch dispatched via GitHub Actions', {
      environment: batchEnvironment === 'development' ? 'preview' : batchEnvironment,
      parallel,
      maxRuns,
      dryRun: input.dryRun,
    });

    return { success: true, data: { dispatched: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'dispatchEvolutionBatchAction', { input }) };
  }
}, 'dispatchEvolutionBatchAction', { logInputs: true, logOutputs: false, logErrors: true });

export const dispatchEvolutionBatchAction = serverReadRequestId(_dispatchEvolutionBatchAction);
