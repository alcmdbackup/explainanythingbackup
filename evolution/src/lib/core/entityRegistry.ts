// Entity registry: lazy-initialized singleton mapping EntityType → Entity instance.
// Static imports are safe here: circular refs resolve because getEntity() is only called at runtime.
//
// NOTE: This file is one of TWO parallel metric registries in the codebase. The other is
// `evolution/src/lib/metrics/registry.ts` (flat METRIC_REGISTRY). Both must be kept in
// sync manually until they're consolidated in a follow-up project.

import type { Entity } from './Entity';
import type { EntityType, EntityMetricRegistry, CatalogMetricDef } from './types';
import { RunEntity } from './entities/RunEntity';
import { StrategyEntity } from './entities/StrategyEntity';
import { ExperimentEntity } from './entities/ExperimentEntity';
import { VariantEntity } from './entities/VariantEntity';
import { InvocationEntity } from './entities/InvocationEntity';
import { PromptEntity } from './entities/PromptEntity';
import { TacticEntity } from './entities/TacticEntity';
import { getAgentClasses } from './agentRegistry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _registry: Record<EntityType, Entity<any>> | null = null;

function initRegistry(): void {
  const invocation = new InvocationEntity();

  // Merge agent-contributed finalization metrics into InvocationEntity (deduplicated by name)
  for (const agent of getAgentClasses()) {
    for (const metricDef of agent.invocationMetrics) {
      if (!invocation.metrics.atFinalization.some(d => d.name === metricDef.name)) {
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
    tactic: new TacticEntity(),
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

function getAllMetricNames(entity: { metrics: { duringExecution: CatalogMetricDef[]; atFinalization: CatalogMetricDef[]; atPropagation: CatalogMetricDef[] } }): string[] {
  const m = entity.metrics;
  return [...m.duringExecution, ...m.atFinalization, ...m.atPropagation].map(d => d.name);
}

export function validateEntityRegistry(): void {
  if (!_registry) return;

  for (const [entityType, entity] of Object.entries(_registry)) {
    const allNames = getAllMetricNames(entity);
    const dupes = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    if (dupes.length > 0) throw new Error(`Duplicate metrics in ${entityType}: ${dupes.join(', ')}`);

    for (const def of entity.metrics.atPropagation) {
      const sourceEntity = _registry![def.sourceEntity as EntityType];
      if (!sourceEntity) {
        throw new Error(`${entityType}.${def.name}: source entity '${def.sourceEntity}' not found`);
      }
      // Dynamic metric prefixes (containing ':') are allowed without explicit registration
      if (!def.sourceMetric.includes(':') && !getAllMetricNames(sourceEntity).includes(def.sourceMetric)) {
        throw new Error(`${entityType}.${def.name}: sourceMetric '${def.sourceMetric}' not found in ${def.sourceEntity} registry`);
      }
    }
  }
}

// ─── Registry Helpers ─────────────────────────────────────────────

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
