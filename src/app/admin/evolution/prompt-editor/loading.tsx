// Loading skeleton for the prompt-editor page.
export default function Loading(): JSX.Element {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="h-8 w-56 bg-[var(--surface-elevated)] rounded animate-pulse" />
      <div className="h-32 bg-[var(--surface-elevated)] rounded-page animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 bg-[var(--surface-elevated)] rounded-page animate-pulse" />
        ))}
      </div>
    </div>
  );
}
