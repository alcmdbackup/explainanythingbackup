// Error boundary for the prompt detail page.
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-8 text-center">
      <h2 className="text-2xl font-display font-bold text-[var(--status-error)] mb-4">Something went wrong</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-4">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-[var(--accent-gold)] text-white rounded-page font-ui text-sm">Try again</button>
    </div>
  );
}
