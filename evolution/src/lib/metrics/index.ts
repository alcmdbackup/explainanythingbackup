// Barrel exports for the evolution metrics system.

export type {
  EntityType, MetricName, StaticMetricName, DynamicMetricName,
  MetricTiming, AggregationMethod,
  MetricDefBase, ExecutionMetricDef, FinalizationMetricDef, PropagationMetricDef,
  EntityMetricRegistry, MetricDef,
  ExecutionContext, FinalizationContext,
  MetricRow, MetricValue, MetricItem,
} from './types';
export { ENTITY_TYPES, STATIC_METRIC_NAMES, DYNAMIC_METRIC_PREFIXES, AGGREGATION_METHODS, MetricRowSchema, toMetricValue, toMetricItem } from './types';

// Legacy registry exports (kept for backward compatibility)
export { METRIC_REGISTRY, validateRegistry, getAllMetricDefs, getListViewMetrics, getMetricDef, isValidMetricName, FORMATTERS } from './registry';

// Entity registry (preferred — replaces METRIC_REGISTRY)
export { getEntity, getEntityMetrics as getEntityMetricDeclarations, getAllEntityMetricDefs, getEntityListViewMetrics, getEntityMetricDef, isValidEntityMetricName } from '../core/entityRegistry';
export { METRIC_FORMATTERS } from '../core/metricCatalog';

export { writeMetrics, writeMetric } from './writeMetrics';
export { getEntityMetrics, getMetric, getMetricsForEntities } from './readMetrics';
export { recomputeStaleMetrics } from './recomputeMetrics';
export { createMetricColumns, createRunsMetricColumns } from './metricColumns';
