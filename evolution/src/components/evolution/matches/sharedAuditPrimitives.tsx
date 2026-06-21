// Shared primitives for Judge Lab match-history audit views (regular sweep + agreement sweep).
// Extracted from src/app/admin/evolution/judge-lab/runs/[evalRunId]/matches/page.tsx so the new
// Agreement /matches sub-route can render the same plain-text audit blocks without re-implementing.
//
// RENDER CONTRACT: every raw / reasoning / prompt field MUST be rendered as plain text only via
// the TextBlock <pre> pattern (auto-escaping). NO dangerouslySetInnerHTML, NO Markdown-to-HTML.
// Judge raws contain LLM-generated text — never inject them as HTML.

'use client';

import type { ReactNode } from 'react';
import type { JudgeEvalCallAudit } from '@evolution/lib/judgeEval/schemas';

/** Best-effort split of a rendered comparison prompt into its two content pieces (## Text A / ## Text B).
 *  Returns null if the prompt doesn't match the expected shape — caller then shows the full prompt only. */
export function extractTexts(prompt: string | null): { textA: string; textB: string } | null {
  if (!prompt) return null;
  const m = prompt.match(
    /## Text A\s*\n([\s\S]*?)\n## Text B\s*\n([\s\S]*?)(?:\n##|\nYour answer|\n[^\n]*your answer|$)/i,
  );
  if (!m) return null;
  return { textA: m[1]!.trim(), textB: m[2]!.trim() };
}

/** Reasoning trace state label — maps the reasoning_trace_format enum to a human string. */
export function reasoningStateLabel(
  fmt: JudgeEvalCallAudit['reasoning_trace_format'],
  hasText: boolean,
): string {
  if (fmt == null) return 'reasoning not requested';
  if (fmt === 'unavailable') return 'thinking happened but the provider dropped the trace';
  return hasText ? `${fmt} reasoning` : `${fmt} (empty)`;
}

interface TextBlockProps {
  label: string;
  value: string | null;
  testid?: string;
  open?: boolean;
}

/** Collapsible block of plain (auto-escaped) text — used for prompts / reasoning / raw output. */
export function TextBlock({ label, value, testid, open = false }: TextBlockProps): ReactNode {
  return (
    <details open={open} className="mt-2">
      <summary className="cursor-pointer text-xs font-ui text-[var(--text-muted)]">{label}</summary>
      <pre
        data-testid={testid}
        className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs font-mono"
      >
        {value && value.length > 0 ? value : '—'}
      </pre>
    </details>
  );
}
