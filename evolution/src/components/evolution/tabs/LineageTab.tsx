'use client';
// Lineage & Tree tab combining DAG visualization with optional tree search view.
// Loads lineage data and tree search data; shows a toggle when tree data exists.

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  getEvolutionRunLineageAction,
  getEvolutionRunTreeSearchAction,
  type LineageData,
  type TreeSearchData,
} from '@evolution/services/evolutionVisualizationActions';
import { ShortId } from '@evolution/components/evolution/agentDetails/shared';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';

/** Toggle button styles shared by view toggles and tree selectors. */
function toggleBtnClass(isActive: boolean): string {
  if (isActive) {
    return 'border-[var(--accent-gold)] text-[var(--accent-gold)] bg-[var(--surface-elevated)]';
  }
  return 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]';
}

const LineageGraph = dynamic(
  () => import('@evolution/components/evolution/LineageGraph').then(m => m.LineageGraph),
  {
    ssr: false,
    loading: () => (
      <div className="h-[500px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />
    ),
  },
);

// ─── Tree Graph (from former TreeTab) ───────────────────────────────

interface TreeGraphProps {
  tree: TreeSearchData['trees'][0];
}

function TreeGraph({ tree }: TreeGraphProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(tree.nodes.map(n => [n.id, n])), [tree.nodes]);

  const winnerPathIds = useMemo(() => {
    const ids = new Set<string>();
    let walkId: string | null = tree.result.bestLeafNodeId;
    while (walkId) {
      ids.add(walkId);
      const n = nodeById.get(walkId);
      walkId = n?.parentNodeId ?? null;
    }
    return ids;
  }, [tree.result.bestLeafNodeId, nodeById]);

  const renderTree = useCallback(async () => {
    if (!svgRef.current || tree.nodes.length === 0) return;

    const d3 = await import('d3');
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 800;
    const height = Math.max(400, (tree.result.maxDepth + 1) * 120 + 80);

    const layers = new Map<number, typeof tree.nodes>();
    for (const node of tree.nodes) {
      const layer = layers.get(node.depth) ?? [];
      layer.push(node);
      layers.set(node.depth, layer);
    }

    const sortedLayers = Array.from(layers.entries()).sort((a, b) => a[0] - b[0]);
    const layerSpacing = Math.min(120, (height - 80) / Math.max(sortedLayers.length, 1));

    const nodePositions = new Map<string, { x: number; y: number }>();
    sortedLayers.forEach(([, layerNodes], layerIdx) => {
      const nodeSpacing = width / (layerNodes.length + 1);
      layerNodes.forEach((node, nodeIdx) => {
        nodePositions.set(node.id, {
          x: nodeSpacing * (nodeIdx + 1),
          y: 40 + layerIdx * layerSpacing,
        });
      });
    });

    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    const edgeData = tree.nodes
      .filter(n => n.parentNodeId)
      .map(n => ({ source: n.parentNodeId!, target: n.id, pruned: n.pruned }));

    g.selectAll('line.edge')
      .data(edgeData)
      .enter()
      .append('line')
      .attr('class', 'edge')
      .attr('x1', d => nodePositions.get(d.source)?.x ?? 0)
      .attr('y1', d => nodePositions.get(d.source)?.y ?? 0)
      .attr('x2', d => nodePositions.get(d.target)?.x ?? 0)
      .attr('y2', d => nodePositions.get(d.target)?.y ?? 0)
      .attr('stroke', d => {
        if (winnerPathIds.has(d.source) && winnerPathIds.has(d.target)) return 'var(--accent-gold)';
        return 'var(--border-default)';
      })
      .attr('stroke-width', d =>
        winnerPathIds.has(d.source) && winnerPathIds.has(d.target) ? 3 : 1.5,
      )
      .attr('stroke-opacity', d => {
        if (winnerPathIds.has(d.source) && winnerPathIds.has(d.target)) return 0.9;
        if (d.pruned) return 0.2;
        return 0.5;
      })
      .attr('stroke-dasharray', d => d.pruned ? '4,3' : 'none');

    g.selectAll('text.edge-label')
      .data(edgeData)
      .enter()
      .append('text')
      .attr('class', 'edge-label')
      .attr('x', d => {
        const sx = nodePositions.get(d.source)?.x ?? 0;
        const tx = nodePositions.get(d.target)?.x ?? 0;
        return (sx + tx) / 2;
      })
      .attr('y', d => {
        const sy = nodePositions.get(d.source)?.y ?? 0;
        const ty = nodePositions.get(d.target)?.y ?? 0;
        return (sy + ty) / 2 - 4;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', d => {
        if (winnerPathIds.has(d.source) && winnerPathIds.has(d.target)) return 'var(--accent-gold)';
        return 'var(--text-muted)';
      })
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('opacity', d => d.pruned ? 0.3 : 0.7)
      .text(d => {
        const targetNode = nodeById.get(d.target);
        if (!targetNode) return '';
        const action = targetNode.revisionAction;
        return action.dimension ?? action.type.replace(/_/g, ' ');
      });

    const nodeGroups = g.selectAll('g.node')
      .data(tree.nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => {
        const pos = nodePositions.get(d.id);
        return `translate(${pos?.x ?? 0},${pos?.y ?? 0})`;
      })
      .style('cursor', 'pointer')
      .on('click', (_event: MouseEvent, d: typeof tree.nodes[0]) => {
        setSelectedNodeId(prev => prev === d.id ? null : d.id);
      });

    nodeGroups.filter(d => winnerPathIds.has(d.id))
      .append('circle')
      .attr('r', 18)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-gold)')
      .attr('stroke-width', 2.5)
      .attr('stroke-opacity', 0.6);

    nodeGroups.append('circle')
      .attr('r', d => d.depth === 0 ? 14 : 10)
      .attr('fill', d => {
        if (d.pruned) return 'var(--surface-elevated)';
        if (winnerPathIds.has(d.id)) return 'var(--accent-gold)';
        return 'var(--accent-copper)';
      })
      .attr('fill-opacity', d => d.pruned ? 0.3 : 0.8)
      .attr('stroke', 'var(--surface-elevated)')
      .attr('stroke-width', 2);

    nodeGroups.append('text')
      .attr('dy', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', d => {
        if (d.pruned) return 'var(--text-muted)';
        return 'var(--surface-primary)';
      })
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(d => `D${d.depth}`);

  }, [tree, winnerPathIds, nodeById]);

  useEffect(() => {
    renderTree();
  }, [renderTree]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width="100%"
        height={Math.max(400, (tree.result.maxDepth + 1) * 120 + 80)}
        className="bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)]"
        data-testid="tree-search-graph"
      />

      {selectedNode && (
        <div
          className="absolute top-4 right-4 w-64 border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-3 space-y-2"
          data-testid="tree-node-detail"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <ShortId id={selectedNode.id} href={buildVariantDetailUrl(selectedNode.id)} />
              {winnerPathIds.has(selectedNode.id) && (
                <span className="text-[var(--accent-gold)]">&#9733;</span>
              )}
            </span>
            <span className={`text-xs font-ui px-2 py-0.5 rounded-page ${
              selectedNode.pruned
                ? 'bg-[var(--surface-secondary)] text-[var(--text-muted)]'
                : 'bg-[var(--surface-secondary)] text-[var(--text-primary)]'
            }`}>
              {selectedNode.pruned ? 'pruned' : `depth ${selectedNode.depth}`}
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)] space-y-1 font-ui">
            <div>Action: <span className="font-mono">{selectedNode.revisionAction.type}</span></div>
            {selectedNode.revisionAction.dimension && (
              <div>Dimension: <span className="font-mono">{selectedNode.revisionAction.dimension}</span></div>
            )}
            <div className="text-[var(--text-secondary)]">{selectedNode.revisionAction.description}</div>
          </div>
          <button
            onClick={() => setSelectedNodeId(null)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-ui"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/** Tree search content panel with selector for multiple trees and stats summary. */
function TreeContent({ treeData }: { treeData: TreeSearchData }): JSX.Element | null {
  const [selectedTreeIdx, setSelectedTreeIdx] = useState(0);
  const tree = treeData.trees[selectedTreeIdx];
  if (!tree) return null;

  return (
    <div className="space-y-4" data-testid="tree-tab">
      {treeData.trees.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] font-ui">Search:</span>
          {treeData.trees.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedTreeIdx(idx)}
              className={`px-3 py-1 text-xs rounded-page border font-ui ${toggleBtnClass(idx === selectedTreeIdx)}`}
            >
              Tree {idx + 1}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)] font-ui">
        <span>Nodes: <span className="text-[var(--text-primary)] font-semibold">{tree.result.treeSize}</span></span>
        <span>Max depth: <span className="text-[var(--text-primary)] font-semibold">{tree.result.maxDepth}</span></span>
        <span>Pruned: <span className="text-[var(--text-primary)] font-semibold">{tree.result.prunedBranches}</span></span>
        <span>
          Path:{' '}
          {tree.result.revisionPath.map((a, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-[var(--border-default)]">&rarr;</span>}
              <span className="font-mono text-[var(--accent-gold)]">{a.dimension ?? a.type}</span>
            </span>
          ))}
        </span>
      </div>

      <TreeGraph tree={tree} />
    </div>
  );
}

// ─── Main Lineage Tab ───────────────────────────────────────────────

interface LineageTabProps {
  runId: string;
  initialView?: 'lineage' | 'tree';
}

export function LineageTab({ runId, initialView = 'lineage' }: LineageTabProps): JSX.Element {
  const [view, setView] = useState<'lineage' | 'tree'>(initialView);
  const [lineageData, setLineageData] = useState<LineageData | null>(null);
  const [lineageLoading, setLineageLoading] = useState(true);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeSearchData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  useEffect(() => {
    async function loadLineage() {
      setLineageLoading(true);
      const result = await getEvolutionRunLineageAction(runId);
      if (result.success && result.data) {
        setLineageData(result.data);
      } else {
        setLineageError(result.error?.message ?? 'Failed to load lineage data');
      }
      setLineageLoading(false);
    }
    async function loadTree() {
      setTreeLoading(true);
      const result = await getEvolutionRunTreeSearchAction(runId);
      if (result.success && result.data) {
        setTreeData(result.data);
      }
      setTreeLoading(false);
    }
    loadLineage();
    loadTree();
  }, [runId]);

  const hasTreeData = !treeLoading && treeData && treeData.trees.length > 0;

  if (lineageLoading) return <div className="h-[500px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (lineageError) return <div className="text-[var(--status-error)] text-sm p-4">{lineageError}</div>;
  if (!lineageData || lineageData.nodes.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4">No lineage data available</div>;
  }

  return (
    <div data-testid="lineage-tab">
      {/* View toggle (only shown when tree search data exists) */}
      {hasTreeData && (
        <div className="flex items-center gap-1 mb-4" data-testid="lineage-view-toggle">
          <button
            onClick={() => setView('lineage')}
            className={`px-3 py-1.5 text-xs rounded-page border font-ui transition-colors ${toggleBtnClass(view === 'lineage')}`}
          >
            Full DAG
          </button>
          <button
            onClick={() => setView('tree')}
            className={`px-3 py-1.5 text-xs rounded-page border font-ui transition-colors ${toggleBtnClass(view === 'tree')}`}
          >
            Pruned Tree
          </button>
        </div>
      )}

      {view === 'lineage' && (
        <LineageGraph nodes={lineageData.nodes} edges={lineageData.edges} treeSearchPath={lineageData.treeSearchPath} />
      )}

      {view === 'tree' && hasTreeData && (
        <TreeContent treeData={treeData!} />
      )}
    </div>
  );
}
