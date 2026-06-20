// Loading skeleton for the Implied Rubric Weights pages.

export default function Loading(): JSX.Element {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
      <div className="h-8 w-64 rounded-page bg-[var(--surface-elevated)] animate-pulse" />
      <div className="h-40 w-full rounded-book bg-[var(--surface-elevated)] animate-pulse" />
      <div className="h-64 w-full rounded-book bg-[var(--surface-elevated)] animate-pulse" />
    </div>
  );
}
