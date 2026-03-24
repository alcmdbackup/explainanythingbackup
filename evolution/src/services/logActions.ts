'use server';
// Server actions for multi-entity log queries.
// Supports querying logs by any entity type with ancestor-column-based aggregation.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import type { EntityType } from '@evolution/lib/pipeline/infra/createEntityLogger';

// ─── Types ───────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  created_at: string;
  level: string;
  agent_name: string | null;
  iteration: number | null;
  variant_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
  entity_type: string;
  entity_id: string;
}

export interface LogFilters {
  level?: string;
  agentName?: string;
  iteration?: number;
  entityType?: string;
  variantId?: string;
  messageSearch?: string;
  limit?: number;
  offset?: number;
}

// ─── Actions ─────────────────────────────────────────────────────

/** Fetch logs for an entity + all descendants via ancestor column queries. */
export const getEntityLogsAction = adminAction(
  'getEntityLogsAction',
  async (
    args: {
      entityType: EntityType;
      entityId: string;
      filters?: LogFilters;
    },
    ctx: AdminContext,
  ): Promise<{ items: LogEntry[]; total: number }> => {
    const { entityType, entityId, filters } = args;
    if (!validateUuid(entityId)) throw new Error('Invalid entityId');

    let query = ctx.supabase
      .from('evolution_logs')
      .select('id, created_at, level, agent_name, iteration, variant_id, message, context, entity_type, entity_id', { count: 'exact' });

    // Query by appropriate ancestor column per entity type
    switch (entityType) {
      case 'run':
        query = query.eq('run_id', entityId);
        break;
      case 'experiment':
        query = query.eq('experiment_id', entityId);
        break;
      case 'strategy':
        query = query.eq('strategy_id', entityId);
        break;
      case 'invocation':
        query = query.eq('entity_type', 'invocation').eq('entity_id', entityId);
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    query = query.order('created_at', { ascending: true });

    // Apply filters
    if (filters?.level) query = query.eq('level', filters.level);
    if (filters?.agentName) query = query.eq('agent_name', filters.agentName);
    if (filters?.iteration !== undefined) query = query.eq('iteration', filters.iteration);
    if (filters?.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters?.variantId) query = query.eq('variant_id', filters.variantId);
    if (filters?.messageSearch) query = query.ilike('message', `%${filters.messageSearch}%`);

    const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data as LogEntry[]) ?? [], total: count ?? 0 };
  },
);
