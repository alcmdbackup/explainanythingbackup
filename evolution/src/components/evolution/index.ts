// Barrel exports for evolution UI components (V2).

export { StatusBadge } from './StatusBadge';
export { EvolutionBreadcrumb } from './EvolutionBreadcrumb';
export type { BreadcrumbItem } from './EvolutionBreadcrumb';
export { TableSkeleton } from './TableSkeleton';
export { EmptyState } from './EmptyState';
export { EntityDetailHeader } from './EntityDetailHeader';
export type { EntityDetailHeaderProps, EntityLink } from './EntityDetailHeader';
export { MetricGrid } from './MetricGrid';
export type { MetricGridProps, MetricItem } from './MetricGrid';
export { EntityTable } from './EntityTable';
export type { EntityTableProps, ColumnDef } from './EntityTable';
export { EntityListPage } from './EntityListPage';
export type { EntityListPageProps, FilterDef, RowAction } from './EntityListPage';
export { EntityDetailTabs, useTabState } from './EntityDetailTabs';
export type { EntityDetailTabsProps, TabDef, UseTabStateOptions } from './EntityDetailTabs';
// RegistryPage removed — use EntityListPage with loadData prop instead
export { NotFoundCard } from './NotFoundCard';
export { FormDialog } from './FormDialog';
export type { FieldDef } from './FormDialog';
export { ConfirmDialog } from './ConfirmDialog';
export { AutoRefreshProvider, useAutoRefresh } from './AutoRefreshProvider';
export { EloSparkline } from './EloSparkline';
export { VariantCard } from './VariantCard';
export { RunsTable, getBaseColumns } from './RunsTable';
export type { BaseRun, RunsColumnDef } from './RunsTable';
export { TextDiff } from './TextDiff';
export { InputArticleSection } from './InputArticleSection';
export { ElapsedTime } from './ElapsedTime';
export { LineageGraph } from './LineageGraph';
export { VariantDetailPanel } from './VariantDetailPanel';
export { EntityMetricsTab } from './tabs/EntityMetricsTab';
