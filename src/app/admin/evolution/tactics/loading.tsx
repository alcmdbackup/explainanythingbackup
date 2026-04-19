// Loading skeleton for the tactics list page.
import { TableSkeleton } from '@evolution/components/evolution';

export default function Loading() {
  return <TableSkeleton rows={10} columns={6} />;
}
