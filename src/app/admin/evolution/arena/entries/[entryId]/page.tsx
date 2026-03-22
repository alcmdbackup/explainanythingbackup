// Redirect from legacy arena entry detail URL to consolidated variant detail page.
import { redirect } from 'next/navigation';

export default async function ArenaEntryDetailPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}): Promise<never> {
  const { entryId } = await params;
  redirect(`/admin/evolution/variants/${entryId}`);
}
