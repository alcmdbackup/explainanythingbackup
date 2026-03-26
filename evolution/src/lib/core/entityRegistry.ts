// Entity registry: lazy-initialized singleton mapping EntityType → Entity instance.
// Static imports are safe here: circular refs resolve because getEntity() is only called at runtime.

import type { Entity } from './Entity';
import type { EntityType, EntityMetricRegistry, CatalogMetricDef } from './types';
import { RunEntity } from './entities/RunEntity';
import { StrategyEntity } from './entities/StrategyEntity';
import { ExperimentEntity } from './entities/ExperimentEntity';
import { VariantEntity } from './entities/VariantEntity';
import { InvocationEntity } from './entities/InvocationEntity';
import { PromptEntity } from './entities/PromptEntity';
import { getAgentClasses } from './agentRegistry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _registry: Record<EntityType, Entity<any>> | null = null;

function initRegistry(): void {
  const invocation = new InvocationEntity();

  // Merge agent-contributed finalization metrics into InvocationEntity
  const agentClasses = getAgentClasses();
  for (const agent of agentClasses) {
    for (const metricDef of agent.invocationMetrics) {
      const alreadyRegistered = invocation.metrics.atFinalization.some(d => d.name === metricDef.name);
      if (!alreadyRegistered) {
        invocation.metrics.atFinalization.push(metricDef);
      }
    }
  }

  _registry = {
    run: new RunEntity(),
    strategy: new StrategyEntity(),
    experiment: new ExperimentEntity(),
    variant: new VariantEntity(),
    invocation,
    prompt: new PromptEntity(),
  };

  validateEntityRegistry();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEntity(type: EntityType): Entity<any> {
  if (!_registry) initRegistry();
  return _registry![type];
}

export function getEntityMetrics(type: EntityType): EntityMetricRegistry {
  return getEntity(type).metrics;
}

/** Validate no duplicate metric names within an entity, and all propagation source metrics exist. */
export function validateEntityRegistry(): void {
  if (!_registry) return;

  for (const [entityType, entity] of Object.entries(_registry)) {
    const m = entity.metrics;
    const allNames = [
      ...m.duringExecution.map(d => d.name),
      ...m.atFinalization.map(d => d.name),
      ...m.atPropagation.map(d => d.name),
    ];
    const dupes = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      throw new Error(`Duplicate metrics in ${entityType}: ${dupes.join(', ')}`);
    }

    // Verify propagation source metrics exist on the source entity
    for (const def of m.atPropagation) {
      const sourceEntity = _registry![def.sourceEntity as EntityType];
      if (!sourceEntity) {
        throw new Error(`${entityType}.${def.name}: source entity '${def.sourceEntity}' not found`);
      }
      const sourceNames = [
        ...sourceEntity.metrics.duringExecution.map(d => d.name),
        ...sourceEntity.metrics.atFinalization.map(d => d.name),
        ...sourceEntity.metrics.atPropagation.map(d => d.name),
      ];
      // Allow dynamic metric prefixes
      const isDynamic = def.sourceMetric.includes(':');
      if (!isDynamic && !sourceNames.includes(def.sourceMetric)) {
        throw new Error(
          `${entityType}.${def.name}: sourceMetric '${def.sourceMetric}' not found in ${def.sourceEntity} registry`,
        );
      }
    }
  }
}

// ─── Registry Helpers (replacements for metrics/registry.ts helpers) ──

export function getAllEntityMetricDefs(type: EntityType): CatalogMetricDef[] {
  const m = getEntity(type).metrics;
  return [...m.duringExecution, ...m.atFinalization, ...m.atPropagation];
}

export function getEntityListViewMetrics(type: EntityType): CatalogMetricDef[] {
  return getAllEntityMetricDefs(type).filter(d => d.listView);
}

export function getEntityMetricDef(type: EntityType, metricName: string): CatalogMetricDef | undefined {
  return getAllEntityMetricDefs(type).find(d => d.name === metricName);
}

export function isValidEntityMetricName(type: EntityType, metricName: string): boolean {
  if (getAllEntityMetricDefs(type).some(d => d.name === metricName)) return true;
  // Allow dynamic metric prefixes
  return metricName.includes(':');
}

/** Reset registry for testing. */
export function _resetRegistryForTesting(): void {
  _registry = null;
}
