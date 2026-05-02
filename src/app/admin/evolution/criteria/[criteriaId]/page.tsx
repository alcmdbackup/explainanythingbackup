// Criteria detail page with 5 tabs: Overview, Metrics, Variants, Runs, By Prompt.
// Read-only views; edits happen on the list page via FormDialog.

import { CriteriaDetailContent } from './CriteriaDetailContent';

export default async function CriteriaDetailPage({ params }: { params: Promise<{ criteriaId: string }> }): Promise<JSX.Element> {
  const { criteriaId } = await params;
  return <CriteriaDetailContent criteriaId={criteriaId} />;
}
