/**
 * /sources/[id] — Server component for source profile pages.
 * Shows source metadata, citing articles, and co-cited sources.
 */

import { notFound } from 'next/navigation';
import { getSourceProfile } from '@/lib/services/sourceDiscovery';
import SourceProfile from '@/components/sources/SourceProfile';

export const dynamic = 'force-dynamic';

interface SourcePageProps {
  params: Promise<{ id: string }>;
}

export default async function SourcePage({ params }: SourcePageProps) {
  const { id } = await params;
  const sourceCacheId = parseInt(id, 10);

  if (isNaN(sourceCacheId) || sourceCacheId <= 0) {
    notFound();
  }

  const profileData = await getSourceProfile(sourceCacheId);

  if (!profileData) {
    notFound();
  }

  return <SourceProfile data={profileData} />;
}
