'use server';
/**
 * Audit logging service for admin actions.
 * Records all admin operations for accountability and compliance.
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { headers } from 'next/headers';

// Types
export type AuditAction =
  | 'hide_explanation'
  | 'restore_explanation'
  | 'bulk_hide_explanations'
  | 'resolve_report'
  | 'disable_user'
  | 'enable_user'
  | 'update_user_notes'
  | 'update_feature_flag'
  | 'backfill_costs';

export type EntityType =
  | 'explanation'
  | 'report'
  | 'user'
  | 'feature_flag'
  | 'system';

export interface AuditLogEntry {
  id: number;
  admin_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  adminUserId?: string;
  action?: AuditAction;
  entityType?: EntityType;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// Sensitive fields that should be redacted from audit logs
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'api_key',
  'apiKey',
  'authorization',
  'cookie',
  'session',
  'credit_card',
  'ssn',
  'email', // Consider if email should be logged
];

/**
 * Sanitize details object by removing sensitive fields.
 * Recursively processes nested objects.
 */
function sanitizeAuditDetails(
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!details) return null;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    // Check if key contains sensitive field names
    const isKeyToRedact = SENSITIVE_FIELDS.some(
      sensitive => key.toLowerCase().includes(sensitive.toLowerCase())
    );

    if (isKeyToRedact) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Handle arrays - sanitize each element if it's an object
      sanitized[key] = value.map(item =>
        item && typeof item === 'object'
          ? sanitizeAuditDetails(item as Record<string, unknown>)
          : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Log an admin action to the audit log.
 * This is called internally by admin actions, not exposed as a user-facing action.
 */
export async function logAdminAction(input: {
  adminUserId: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();

    // Get request headers for IP and user agent
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ipAddress = forwardedFor?.split(',')[0]?.trim() || headersList.get('x-real-ip') || null;
    const userAgent = headersList.get('user-agent') || null;

    // Sanitize details before logging
    const sanitizedDetails = sanitizeAuditDetails(input.details);

    const { error } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_user_id: input.adminUserId,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        details: sanitizedDetails,
        ip_address: ipAddress,
        user_agent: userAgent
      });

    if (error) {
      // Log error but don't throw - audit logging should not break admin operations
      logger.error('Failed to write audit log', {
        error: error.message,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId
      });
    }
  } catch (error) {
    // Silently fail - audit logging should not break admin operations
    logger.error('Audit logging exception', {
      error: error instanceof Error ? error.message : 'Unknown error',
      action: input.action
    });
  }
}

/**
 * Get audit log entries for admin review.
 */
const _getAuditLogsAction = withLogging(async (
  filters: AuditLogFilters = {}
): Promise<{
  success: boolean;
  data: { logs: AuditLogEntry[]; total: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();
    const { limit = 50, offset = 0 } = filters;

    let query = supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters.adminUserId) {
      query = query.eq('admin_user_id', filters.adminUserId);
    }
    if (filters.action) {
      query = query.eq('action', filters.action);
    }
    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters.entityId) {
      query = query.eq('entity_id', filters.entityId);
    }
    if (filters.startDate) {
      query = query.gte('created_at', `${filters.startDate}T00:00:00Z`);
    }
    if (filters.endDate) {
      query = query.lte('created_at', `${filters.endDate}T23:59:59Z`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Error fetching audit logs', { error: error.message });
      throw error;
    }

    return {
      success: true,
      data: {
        logs: (data || []) as AuditLogEntry[],
        total: count || 0
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAuditLogsAction', { filters })
    };
  }
}, 'getAuditLogsAction');

export const getAuditLogsAction = serverReadRequestId(_getAuditLogsAction);

/**
 * Get unique admin users who have audit log entries.
 * Used for filtering in the UI.
 */
const _getAuditAdminsAction = withLogging(async (): Promise<{
  success: boolean;
  data: { adminId: string; count: number }[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    // Get distinct admin user IDs with counts
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select('admin_user_id');

    if (error) {
      logger.error('Error fetching audit admins', { error: error.message });
      throw error;
    }

    // Aggregate counts
    const countMap = new Map<string, number>();
    for (const row of data || []) {
      const count = countMap.get(row.admin_user_id) || 0;
      countMap.set(row.admin_user_id, count + 1);
    }

    const result = Array.from(countMap.entries())
      .map(([adminId, count]) => ({ adminId, count }))
      .sort((a, b) => b.count - a.count);

    return {
      success: true,
      data: result,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'getAuditAdminsAction', {})
    };
  }
}, 'getAuditAdminsAction');

export const getAuditAdminsAction = serverReadRequestId(_getAuditAdminsAction);

/**
 * Export audit logs as CSV (returns data, client formats as CSV).
 */
const _exportAuditLogsAction = withLogging(async (
  filters: AuditLogFilters = {}
): Promise<{
  success: boolean;
  data: AuditLogEntry[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000); // Safety limit for exports

    if (filters.adminUserId) {
      query = query.eq('admin_user_id', filters.adminUserId);
    }
    if (filters.action) {
      query = query.eq('action', filters.action);
    }
    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters.startDate) {
      query = query.gte('created_at', `${filters.startDate}T00:00:00Z`);
    }
    if (filters.endDate) {
      query = query.lte('created_at', `${filters.endDate}T23:59:59Z`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error exporting audit logs', { error: error.message });
      throw error;
    }

    return {
      success: true,
      data: (data || []) as AuditLogEntry[],
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: handleError(error, 'exportAuditLogsAction', { filters })
    };
  }
}, 'exportAuditLogsAction');

export const exportAuditLogsAction = serverReadRequestId(_exportAuditLogsAction);
