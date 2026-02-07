// Tree search visualization tab showing beam search tree structure.
// Renders depth-layered tree with pruned branches dimmed and winner path highlighted in gold.
'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  getEvolutionRunTreeSearchAction,
  type TreeSearchData,
} from '@/lib/services/evolutionVisualizationActions';

interface TreeTabProps {
  runId: string;
}

export function TreeTab({ runId }: TreeTabProps) {
  const [data, setData] = useState<TreeSearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTreeIdx, setSelectedTreeIdx] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunTreeSearchAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load tree search data');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) return <div className="h-[500px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (!data || data.trees.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4">No tree search data available for this run.</div>;
  }

  const tree = data.trees[selectedTreeIdx];
  if (!tree) return null;

  return (
    <div className="space-y-4" data-testid="tree-tab">
      {/* Tree selector (if multiple trees) */}
      {data.trees.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] font-ui">Search:</span>
          {data.trees.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedTreeIdx(idx)}
              className={`px-3 py-1 text-xs rounded-page border font-ui ${
                idx === selectedTreeIdx
                  ? 'border-[var(--accent-gold)] text-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                  : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Tree {idx + 1}
            </button>
          ))}
        </div>
      )}

      {/* Stats summary */}
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

      {/* Tree visualization */}
      <TreeGraph tree={tree} />
    </div>
  );
}

// ─── Tree Graph SVG Component ────────────────────────────────────

interface TreeGraphProps {
  tree: TreeSearchData['trees'][0];
}

function TreeGraph({ tree }: TreeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(tree.nodes.map(n => [n.id, n])), [tree.nodes]);

  // Build winning path set
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

    // Group nodes by depth
    const layers = new Map<number, typeof tree.nodes>();
    for (const node of tree.nodes) {
      const layer = layers.get(node.depth) ?? [];
      layer.push(node);
      layers.set(node.depth, layer);
    }

    const sortedLayers = Array.from(layers.entries()).sort((a, b) => a[0] - b[0]);
    const layerSpacing = Math.min(120, (height - 80) / Math.max(sortedLayers.length, 1));

    // Position nodes
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

    // Create zoom group
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Draw edges
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

    // Edge labels (revision action type)
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

    // Draw nodes
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

    // Winner path highlight ring
    nodeGroups.filter(d => winnerPathIds.has(d.id))
      .append('circle')
      .attr('r', 18)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-gold)')
      .attr('stroke-width', 2.5)
      .attr('stroke-opacity', 0.6);

    // Node circles — size by depth position, opacity by pruned status
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

    // Node labels (depth level)
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

      {/* Node detail panel */}
      {selectedNode && (
        <div
          className="absolute top-4 right-4 w-64 border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-3 space-y-2"
          data-testid="tree-node-detail"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {selectedNode.id.substring(0, 8)}
              {winnerPathIds.has(selectedNode.id) && (
                <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>
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
