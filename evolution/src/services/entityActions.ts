// Generic entity action dispatcher: validates input, delegates to Entity.executeAction().
'use server';

import { adminAction } from './adminAction';
import { getEntity } from '../lib/core/entityRegistry';
import { CORE_ENTITY_TYPES, type EntityType } from '../lib/core/types';
import { logAdminAction } from '@/lib/services/auditLog';

// ─── Input Types ──────────────────────────────────────────────────

export interface EntityActionInput {
  entityType: string;
  entityId: string;
  actionKey: string;
  payload?: Record<string, unknown>;
}

export interface EntityActionResult {
  entityType: string;
  entityId: string;
  actionKey: string;
  /** For delete actions: count of descendants that were also deleted. */
  descendantCount?: Record<string, number>;
}

// ─── Validation ───────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateEntityActionInput(input: EntityActionInput): void {
  if (!CORE_ENTITY_TYPES.includes(input.entityType as EntityType)) {
    throw new Error(`Invalid entity type: ${input.entityType}`);
  }
  if (!UUID_REGEX.test(input.entityId)) {
    throw new Error(`Invalid entity ID: must be a valid UUID`);
  }
  const entity = getEntity(input.entityType as EntityType);
  if (!entity.actions.some(a => a.key === input.actionKey)) {
    throw new Error(`Invalid action '${input.actionKey}' for entity type '${input.entityType}'`);
  }
}

// ─── Descendant Counting ──────────────────────────────────────────

async function countDescendants(
  entityType: EntityType,
  entityId: string,
  supabase: import('@supabase/supabase-js').SupabaseClient,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const entity = getEntity(entityType);
  for (const child of entity.children) {
    const childEntity = getEntity(child.childType);
    const { count } = await supabase.from(childEntity.table)
      .select('id', { count: 'exact', head: true })
      .eq(child.foreignKey, entityId);
    const n = count ?? 0;
    if (n > 0) {
      counts[child.childType] = (counts[child.childType] ?? 0) + n;
      // Recursively count grandchildren
      const { data: childRows } = await supabase.from(childEntity.table)
        .select('id').eq(child.foreignKey, entityId);
      for (const row of childRows ?? []) {
        const sub = await countDescendants(child.childType, row.id, supabase);
        for (const [k, v] of Object.entries(sub)) {
          counts[k] = (counts[k] ?? 0) + v;
        }
      }
    }
  }
  return counts;
}

// ─── Server Action ────────────────────────────────────────────────

export const executeEntityAction = adminAction<EntityActionInput, EntityActionResult>(
  'executeEntityAction',
  async (input, { supabase, adminUserId }) => {
    validateEntityActionInput(input);

    const entity = getEntity(input.entityType as EntityType);

    // For delete: count descendants before executing
    let descendantCount: Record<string, number> | undefined;
    if (input.actionKey === 'delete') {
      descendantCount = await countDescendants(input.entityType as EntityType, input.entityId, supabase);
    }

    await entity.executeAction(input.actionKey, input.entityId, supabase, input.payload);

    // B007-S5: forensic audit log. Without this, no one could later answer "who deleted
    // strategy X?". logAdminAction is fire-and-forget — failures don't block the action.
    try {
      // Cast: AuditAction is a const union upstream that doesn't yet enumerate the
      // generic entity-action verbs. We log via the closest existing kind.
      await logAdminAction({
        adminUserId,
        action: 'entity_action' as Parameters<typeof logAdminAction>[0]['action'],
        entityType: input.entityType as Parameters<typeof logAdminAction>[0]['entityType'],
        entityId: input.entityId,
        details: { actionKey: input.actionKey, ...(descendantCount ? { descendantCount } : {}) },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      console.warn('[entityActions] audit log write failed (non-fatal)', {
        entityType: input.entityType, entityId: input.entityId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    return {
      entityType: input.entityType,
      entityId: input.entityId,
      actionKey: input.actionKey,
      descendantCount,
    };
  },
);
