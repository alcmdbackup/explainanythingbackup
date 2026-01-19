'use server';
/**
 * Content reports server actions.
 * Handles user-submitted reports and admin review workflow.
 */

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';

// Types
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'actioned';

export type ReportReason =
  | 'inappropriate'
  | 'misinformation'
  | 'spam'
  | 'copyright'
  | 'other';

export interface ContentReport {
  id: number;
  explanation_id: number;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

export interface ContentReportWithExplanation extends ContentReport {
  explanation_title?: string;
}

export interface CreateReportInput {
  explanation_id: number;
  reason: ReportReason;
  details?: string;
}

export interface ResolveReportInput {
  report_id: number;
  status: 'reviewed' | 'dismissed' | 'actioned';
  review_notes?: string;
  hide_explanation?: boolean;
}

/**
 * Create a content report (user-facing action).
 * Any authenticated user can report content.
 */
const _createContentReportAction = withLogging(async (
  input: CreateReportInput
): Promise<{
  success: boolean;
  data: ContentReport | null;
  error: ErrorResponse | null;
}> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        data: null,
        error: { code: 'INVALID_INPUT', message: 'Must be logged in to report content' }
      };
    }

    // Validate input
    if (!input.explanation_id || !input.reason) {
      return {
        success: false,
        data: null,
        error: { code: 'INVALID_INPUT', message: 'Explanation ID and reason are required' }
      };
    }

    // Check if user already reported this content
    const { data: existingReport } = await supabase
      .from('content_reports')
      .select('id')
      .eq('explanation_id', input.explanation_id)
      .eq('reporter_id', user.id)
      .eq('status', 'pending')
      .limit(1);

    if (existingReport && existingReport.length > 0) {
      return {
        success: false,
        data: null,
        error: { code: 'INVALID_INPUT', message: 'You have already reported this content' }
      };
    }

    const { data, error } = await supabase
      .from('content_reports')
      .insert({
        explanation_id: input.explanation_id,
        reporter_id: user.id,
        reason: input.reason,
        details: input.details || null,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating content report', { error: error.message });
      throw error;
    }

    logger.info('Content report created', {
      reportId: data.id,
      explanationId: input.explanation_id,
      reason: input.reason
    });

    return {
      success: true,
      data: data as ContentReport,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'createContentReportAction', { input })
    };
  }
}, 'createContentReportAction');

export const createContentReportAction = serverReadRequestId(_createContentReportAction);

/**
 * Get content reports for admin review.
 * Includes explanation title for context.
 */
const _getContentReportsAction = withLogging(async (
  filters: {
    status?: ReportStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{
  success: boolean;
  data: { reports: ContentReportWithExplanation[]; total: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const { status, limit = 50, offset = 0 } = filters;

    const supabase = await createSupabaseServiceClient();

    // Get reports with explanation titles via join
    let query = supabase
      .from('content_reports')
      .select(`
        *,
        explanations!inner(explanation_title)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching content reports', { error: error.message });
      throw error;
    }

    // Transform to include explanation_title at top level
    const reports: ContentReportWithExplanation[] = (data || []).map((report: ContentReport & { explanations: { explanation_title: string } }) => ({
      ...report,
      explanation_title: report.explanations?.explanation_title,
      explanations: undefined
    }));

    return {
      success: true,
      data: {
        reports,
        total: count || 0
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getContentReportsAction', { filters })
    };
  }
}, 'getContentReportsAction');

export const getContentReportsAction = serverReadRequestId(_getContentReportsAction);

/**
 * Resolve a content report.
 * Admin can dismiss, mark reviewed, or take action (hide content).
 */
const _resolveContentReportAction = withLogging(async (
  input: ResolveReportInput
): Promise<{
  success: boolean;
  error: ErrorResponse | null;
}> => {
  try {
    const adminUserId = await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Update report status
    const { error: reportError } = await supabase
      .from('content_reports')
      .update({
        status: input.status,
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
        review_notes: input.review_notes || null
      })
      .eq('id', input.report_id);

    if (reportError) {
      logger.error('Error resolving report', { reportId: input.report_id, error: reportError.message });
      throw reportError;
    }

    // If actioned and hide_explanation is true, hide the explanation
    if (input.status === 'actioned' && input.hide_explanation) {
      // Get explanation ID from report
      const { data: report } = await supabase
        .from('content_reports')
        .select('explanation_id')
        .eq('id', input.report_id)
        .single();

      if (report) {
        await supabase
          .from('explanations')
          .update({
            delete_status: 'hidden',
            delete_status_changed_at: new Date().toISOString(),
            delete_source: 'manual',
            delete_reason: `Report resolved: ${input.review_notes || 'No notes provided'}`
          })
          .eq('id', report.explanation_id);

        logger.info('Explanation hidden due to report', {
          reportId: input.report_id,
          explanationId: report.explanation_id
        });
      }
    }

    logger.info('Content report resolved', {
      reportId: input.report_id,
      status: input.status,
      adminUserId
    });

    // Log audit action
    await logAdminAction({
      adminUserId,
      action: 'resolve_report',
      entityType: 'report',
      entityId: String(input.report_id),
      details: {
        status: input.status,
        hideExplanation: input.hide_explanation || false,
        hasNotes: !!input.review_notes
      }
    });

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'resolveContentReportAction', { input })
    };
  }
}, 'resolveContentReportAction');

export const resolveContentReportAction = serverReadRequestId(_resolveContentReportAction);

/**
 * Get report count by status for dashboard display.
 */
const _getReportCountsAction = withLogging(async (): Promise<{
  success: boolean;
  data: { pending: number; total: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    const { count: pendingCount } = await supabase
      .from('content_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: totalCount } = await supabase
      .from('content_reports')
      .select('*', { count: 'exact', head: true });

    return {
      success: true,
      data: {
        pending: pendingCount || 0,
        total: totalCount || 0
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getReportCountsAction', {})
    };
  }
}, 'getReportCountsAction');

export const getReportCountsAction = serverReadRequestId(_getReportCountsAction);
