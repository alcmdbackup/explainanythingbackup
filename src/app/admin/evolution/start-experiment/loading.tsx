// Loading skeleton for the start-experiment page, matching ExperimentForm layout.
export default function StartExperimentLoading(): JSX.Element {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-48 bg-[var(--surface-elevated)] rounded" />
      <div className="h-10 w-64 bg-[var(--surface-elevated)] rounded" />
      <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] p-6 space-y-4">
        <div className="h-6 w-40 bg-[var(--surface-elevated)] rounded" />
        <div className="flex gap-4">
          <div className="h-8 w-20 bg-[var(--surface-elevated)] rounded" />
          <div className="h-8 w-20 bg-[var(--surface-elevated)] rounded" />
          <div className="h-8 w-20 bg-[var(--surface-elevated)] rounded" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-32 bg-[var(--surface-elevated)] rounded" />
          <div className="h-10 w-full bg-[var(--surface-elevated)] rounded" />
          <div className="h-4 w-24 bg-[var(--surface-elevated)] rounded" />
          <div className="h-20 w-full bg-[var(--surface-elevated)] rounded" />
          <div className="h-4 w-36 bg-[var(--surface-elevated)] rounded" />
          <div className="h-10 w-48 bg-[var(--surface-elevated)] rounded" />
        </div>
        <div className="h-10 w-full bg-[var(--accent-gold)] opacity-30 rounded" />
      </div>
    </div>
  );
}
