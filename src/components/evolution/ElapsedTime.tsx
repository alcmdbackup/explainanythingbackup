'use client';
// Client component that shows elapsed time with live ticking for active runs.
// For completed runs shows static duration; for pending shows "--".

import { useEffect, useState } from 'react';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ElapsedTime({ startedAt, completedAt, status }: {
  startedAt: string | null;
  completedAt: string | null;
  status: string;
}) {
  const [now, setNow] = useState(Date.now());

  const isActive = status === 'running' || status === 'claimed';

  useEffect(() => {
    if (!isActive || !startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive, startedAt]);

  if (!startedAt) return <span className="text-[var(--text-muted)]">--</span>;

  const start = new Date(startedAt).getTime();
  const end = isActive ? now : (completedAt ? new Date(completedAt).getTime() : now);
  const elapsed = Math.max(end - start, 0);

  return (
    <span className="font-mono text-xs" title={`Started: ${startedAt}`}>
      {formatDuration(elapsed)}
    </span>
  );
}
