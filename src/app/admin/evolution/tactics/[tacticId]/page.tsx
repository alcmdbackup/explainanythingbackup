// Tactic detail page — shows prompt text (from code), metrics, variants, runs, and per-prompt breakdown.
// Server component that fetches the tactic row + code-defined prompt, then renders client content.

import { getTacticDetailAction } from '@evolution/services/tacticActions';
import { notFound } from 'next/navigation';
import { TacticDetailContent } from './TacticDetailContent';

interface PageProps {
  params: Promise<{ tacticId: string }>;
}

export default async function TacticDetailPage({ params }: PageProps) {
  const { tacticId } = await params;
  const result = await getTacticDetailAction({ tacticId });

  if (!result.success || !result.data) {
    notFound();
  }

  return <TacticDetailContent tactic={result.data} />;
}
