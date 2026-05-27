// Subagents tab on invocation detail. Renders the recursive agent → subagent tree
// (L1 = the invocation; L2+ = nested sub-units of work) derived from execution_detail
// JSONB via buildSubagentTree. Replaces the inline-only nested data view; bespoke
// per-wrapper tabs (Reflection Overview, Eval & Suggest, Edit Cycle, etc.) remain
// available alongside this generic tree.
//
// rename_agents_subagents_evolution_20260508 — Phase 2.

'use client';

import { useState, useMemo } from 'react';
import {
  buildSubagentTree,
  validateTreeTotals,
  type InvocationForTree,
  type SubagentNode,
} from '@evolution/lib/shared/buildSubagentTree';

interface SubagentsTabProps {
  invocation: InvocationForTree;
}

const KIND_BADGE: Record<SubagentNode['kind'], { label: string; className: string }> = {
  LLM:           { label: 'LLM',           className: 'bg-blue-100 text-blue-800' },
  Composite:     { label: 'Composite',     className: 'bg-purple-100 text-purple-800' },
  Deterministic: { label: 'Deterministic', className: 'bg-gray-200 text-gray-800' },
};

function formatCost(usd: number): string {
  if (usd === 0) return '$0.000';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(3)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SubagentRow({ node, defaultOpen }: { node: SubagentNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? node.level <= 2);
  const hasChildren = node.children.length > 0;
  const indent = (node.level - 1) * 16;
  return (
    <div className="border-l border-gray-200">
      <button
        type="button"
        onClick={() => hasChildren && setOpen(!open)}
        className="flex w-full items-center gap-2 py-1.5 px-2 text-left hover:bg-gray-50 disabled:cursor-default"
        disabled={!hasChildren}
        style={{ paddingLeft: `${indent}px` }}
        data-testid={`subagent-row-${node.path.join('.')}`}
      >
        <span className="w-4 text-gray-400">
          {hasChildren ? (open ? '▼' : '▶') : ' '}
        </span>
        <span className="text-xs font-mono text-gray-500 w-8">L{node.level}</span>
        <span className="font-mono text-sm flex-1 truncate" title={node.path.join('.')}>
          {node.name}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${KIND_BADGE[node.kind].className}`}>
          {KIND_BADGE[node.kind].label}
        </span>
        <span className="text-xs text-gray-600 font-mono w-16 text-right">
          {formatDuration(node.durationMs)}
        </span>
        <span className="text-xs text-gray-600 font-mono w-20 text-right">
          {formatCost(node.costUsd)}
        </span>
        <span className="text-xs text-gray-500 w-24 text-right truncate">
          {node.summary ?? (node.llmCallCount > 0 ? `${node.llmCallCount} LLM call${node.llmCallCount === 1 ? '' : 's'}` : '')}
        </span>
      </button>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <SubagentRow key={child.path.join('.')} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SubagentsTab({ invocation }: SubagentsTabProps) {
  const tree = useMemo(() => buildSubagentTree(invocation), [invocation]);
  const validation = useMemo(() => validateTreeTotals(tree), [tree]);

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 px-2">
        Tree levels: L1 = the agent invocation; L2+ = subagents (recursive).
        Cost and duration sum upward — an L1 row&apos;s totals equal the recursive sum of its children.
      </div>
      {validation && process.env.NODE_ENV !== 'production' && (
        <div
          role="alert"
          data-testid="subagent-tree-validation-warning"
          className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200"
        >
          ⚠ Tree-totals mismatch: {validation.mismatch}
        </div>
      )}
      <div className="border rounded">
        <SubagentRow node={tree} defaultOpen />
      </div>
    </div>
  );
}
