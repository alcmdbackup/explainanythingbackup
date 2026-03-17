// Router component that delegates to type-specific detail views based on detailType discriminator.
// Renders structured execution data for each agent type in the evolution pipeline.

import type { AgentExecutionDetail } from '@evolution/lib/types';
import type { VariantBeforeAfter } from '@evolution/services/evolutionVisualizationActions';
import { GenerationDetail } from './GenerationDetail';
import { CalibrationDetail } from './CalibrationDetail';
import { TournamentDetail } from './TournamentDetail';
import { RankingDetail } from './RankingDetail';
import { IterativeEditingDetail } from './IterativeEditingDetail';
import { ReflectionDetail } from './ReflectionDetail';
import { DebateDetail } from './DebateDetail';
import { SectionDecompositionDetail } from './SectionDecompositionDetail';
import { EvolutionDetail } from './EvolutionDetail';
import { TreeSearchDetail } from './TreeSearchDetail';
import { OutlineGenerationDetail } from './OutlineGenerationDetail';
import { ProximityDetail } from './ProximityDetail';
import { MetaReviewDetail } from './MetaReviewDetail';

/** Optional enrichment data passed from the invocation detail page. */
export interface AgentDetailEnrichment {
  eloChanges?: Record<string, number>;
  variantDiffs?: VariantBeforeAfter[];
  eloHistory?: Record<string, { iteration: number; elo: number }[]>;
}

export function AgentExecutionDetailView({ detail, runId, enrichment }: {
  detail: AgentExecutionDetail;
  runId?: string;
  enrichment?: AgentDetailEnrichment;
}): JSX.Element {
  switch (detail.detailType) {
    case 'generation': return <GenerationDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'calibration': return <CalibrationDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'tournament': return <TournamentDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'ranking': return <RankingDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'iterativeEditing': return <IterativeEditingDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'reflection': return <ReflectionDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'debate': return <DebateDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'sectionDecomposition': return <SectionDecompositionDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'evolution': return <EvolutionDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'treeSearch': return <TreeSearchDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'outlineGeneration': return <OutlineGenerationDetail detail={detail} runId={runId} enrichment={enrichment} />;
    case 'proximity': return <ProximityDetail detail={detail} runId={runId} />;
    case 'metaReview': return <MetaReviewDetail detail={detail} runId={runId} enrichment={enrichment} />;
    default: {
      const _exhaustive: never = detail;
      return <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(_exhaustive, null, 2)}</pre>;
    }
  }
}
