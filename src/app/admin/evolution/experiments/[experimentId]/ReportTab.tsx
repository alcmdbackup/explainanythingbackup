// Report tab: V2 does not support experiment reports.
// Shows an informational empty state instead of the former LLM-generated report.

'use client';

export function ReportTab() {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-body text-[var(--text-muted)]">
        Experiment reports are not available in V2.
      </p>
    </div>
  );
}
