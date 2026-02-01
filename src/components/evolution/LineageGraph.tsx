'use client';
// D3-based directed acyclic graph (DAG) visualization for variant lineage.
// Uses d3-dag for Sugiyama layout and d3 for SVG rendering with zoom/pan.

import { useRef, useEffect, useState, useCallback } from 'react';
import { VariantCard } from '@/components/evolution/VariantCard';
import { STRATEGY_PALETTE } from '@/components/evolution/VariantCard';
import type { LineageData } from '@/lib/services/evolutionVisualizationActions';

interface LineageGraphProps {
  nodes: LineageData['nodes'];
  edges: LineageData['edges'];
}

export function LineageGraph({ nodes, edges }: LineageGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<LineageData['nodes'][0] | null>(null);

  const renderGraph = useCallback(async () => {
    if (!svgRef.current || nodes.length === 0) return;

    const d3 = await import('d3');
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 800;
    const height = 500;

    // Simple layered layout: group nodes by iterationBorn
    const layers = new Map<number, LineageData['nodes']>();
    for (const node of nodes) {
      const layer = layers.get(node.iterationBorn) ?? [];
      layer.push(node);
      layers.set(node.iterationBorn, layer);
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

    // Create zoom behavior
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Draw edges
    g.selectAll('line.edge')
      .data(edges)
      .enter()
      .append('line')
      .attr('class', 'edge')
      .attr('x1', d => nodePositions.get(d.source)?.x ?? 0)
      .attr('y1', d => nodePositions.get(d.source)?.y ?? 0)
      .attr('x2', d => nodePositions.get(d.target)?.x ?? 0)
      .attr('y2', d => nodePositions.get(d.target)?.y ?? 0)
      .attr('stroke', 'var(--border-default)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5);

    // Draw nodes
    const eloValues = nodes.map(n => n.elo);
    const minElo = Math.min(...eloValues);
    const maxElo = Math.max(...eloValues);
    const scaleRadius = d3.scaleLinear().domain([minElo, maxElo]).range([6, 18]);

    const nodeGroups = g.selectAll('g.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => {
        const pos = nodePositions.get(d.id);
        return `translate(${pos?.x ?? 0},${pos?.y ?? 0})`;
      })
      .attr('data-testid', d => `lineage-node-${d.shortId}`)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        setSelectedNode(prev => prev?.id === d.id ? null : d);
      });

    // Winner highlight ring
    nodeGroups.filter(d => d.isWinner)
      .append('circle')
      .attr('r', d => scaleRadius(d.elo) + 4)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-gold)')
      .attr('stroke-width', 2.5);

    // Node circles
    nodeGroups.append('circle')
      .attr('r', d => scaleRadius(d.elo))
      .attr('fill', d => STRATEGY_PALETTE[d.strategy] ?? 'var(--text-muted)')
      .attr('stroke', 'var(--surface-elevated)')
      .attr('stroke-width', 2);

    // Labels
    nodeGroups.append('text')
      .attr('dy', d => scaleRadius(d.elo) + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', 9)
      .attr('font-family', 'monospace')
      .text(d => d.shortId);

  }, [nodes, edges]);

  useEffect(() => {
    renderGraph();
  }, [renderGraph]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width="100%"
        height={500}
        className="bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)]"
        data-testid="lineage-graph"
      />

      {/* Side panel for selected node */}
      {selectedNode && (
        <div className="absolute top-4 right-4 w-64" data-testid="lineage-detail-panel">
          <VariantCard
            shortId={selectedNode.shortId}
            elo={selectedNode.elo}
            strategy={selectedNode.strategy}
            iterationBorn={selectedNode.iterationBorn}
            isWinner={selectedNode.isWinner}
          />
          <button
            onClick={() => setSelectedNode(null)}
            className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
