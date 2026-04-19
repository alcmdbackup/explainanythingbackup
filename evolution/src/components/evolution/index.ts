// Barrel exports for evolution UI components (V2).

// primitives/
export { StatusBadge } from './primitives/StatusBadge';
export { EvolutionBreadcrumb } from './primitives/EvolutionBreadcrumb';
export type { BreadcrumbItem } from './primitives/EvolutionBreadcrumb';
export { EmptyState } from './primitives/EmptyState';
export { MetricGrid } from './primitives/MetricGrid';
export type { MetricGridProps, MetricItem } from './primitives/MetricGrid';
export { NotFoundCard } from './primitives/NotFoundCard';

// tables/
export { TableSkeleton } from './tables/TableSkeleton';
export { EntityTable } from './tables/EntityTable';
export type { EntityTableProps, ColumnDef } from './tables/EntityTable';
export { RunsTable, getBaseColumns } from './tables/RunsTable';
export type { BaseRun, RunsColumnDef } from './tables/RunsTable';

// sections/
export { EntityDetailHeader } from './sections/EntityDetailHeader';
export type { EntityDetailHeaderProps, EntityLink } from './sections/EntityDetailHeader';
export { EntityDetailTabs, useTabState } from './sections/EntityDetailTabs';
export type { EntityDetailTabsProps, TabDef, UseTabStateOptions } from './sections/EntityDetailTabs';
export { InputArticleSection } from './sections/InputArticleSection';
export { VariantDetailPanel } from './sections/VariantDetailPanel';

// visualizations/
export { VariantCard } from './visualizations/VariantCard';
export { TextDiff } from './visualizations/TextDiff';
export { LineageGraph } from './visualizations/LineageGraph';

// dialogs/
export { FormDialog } from './dialogs/FormDialog';
export type { FieldDef } from './dialogs/FormDialog';
export { ConfirmDialog } from './dialogs/ConfirmDialog';

// context/
export { AutoRefreshProvider, useAutoRefresh } from './context/AutoRefreshProvider';

// page shells (remain at root)
export { EntityListPage } from './EntityListPage';
export type { EntityListPageProps, FilterDef, RowAction } from './EntityListPage';

// tabs/
export { EntityMetricsTab } from './tabs/EntityMetricsTab';
export { CostEstimatesTab } from './tabs/CostEstimatesTab';
