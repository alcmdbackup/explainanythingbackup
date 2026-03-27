// Loading skeleton for the evolution invocations list page.
import { TableSkeleton } from '@evolution/components/evolution/TableSkeleton';

export default function Loading(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 bg-[var(--surface-elevated)] rounded animate-pulse" />
      <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] p-6">
        <TableSkeleton columns={5} rows={8} />
      </div>
    </div>
  );
}
