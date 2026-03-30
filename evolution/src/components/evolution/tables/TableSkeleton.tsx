// Shared table loading skeleton that mimics a real table layout with animated rows.
// Use `columns` and `rows` props to match the target table shape.

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  testId?: string;
}

export function TableSkeleton({ columns = 5, rows = 5, testId }: TableSkeletonProps): JSX.Element {
  return (
    <div data-testid={testId ?? 'table-skeleton'}>
      <table className="w-full">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-3 py-2">
                <div className="h-3 w-16 bg-[var(--surface-elevated)] rounded animate-pulse" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="border-t border-[var(--border-default)]">
              {Array.from({ length: columns }).map((_, j) => (
                <td key={j} className="px-3 py-2.5">
                  <div
                    className="h-4 bg-[var(--surface-elevated)] rounded animate-pulse"
                    style={{ width: `${50 + (j * 13) % 40}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
