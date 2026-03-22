// Wrapper component that delegates to the shared MetricsTab from the evolution tabs barrel.
// Exists as a page-level component to keep the run detail page clean.
'use client';

import { MetricsTab } from '@evolution/components/evolution/tabs/MetricsTab';

interface RunMetricsTabProps {
  runId: string;
}

export function RunMetricsTab({ runId }: RunMetricsTabProps): JSX.Element {
  return <MetricsTab runId={runId} />;
}
