// Router component that delegates to type-specific detail views based on detailType discriminator.
// Renders structured execution data for each agent type in the evolution pipeline.

import type { AgentExecutionDetail } from '@/lib/evolution/types';
import { GenerationDetail } from './GenerationDetail';
import { CalibrationDetail } from './CalibrationDetail';
import { TournamentDetail } from './TournamentDetail';
import { IterativeEditingDetail } from './IterativeEditingDetail';
import { ReflectionDetail } from './ReflectionDetail';
import { DebateDetail } from './DebateDetail';
import { SectionDecompositionDetail } from './SectionDecompositionDetail';
import { EvolutionDetail } from './EvolutionDetail';
import { TreeSearchDetail } from './TreeSearchDetail';
import { OutlineGenerationDetail } from './OutlineGenerationDetail';
import { ProximityDetail } from './ProximityDetail';
import { MetaReviewDetail } from './MetaReviewDetail';

export function AgentExecutionDetailView({ detail }: { detail: AgentExecutionDetail }): JSX.Element {
  switch (detail.detailType) {
    case 'generation': return <GenerationDetail detail={detail} />;
    case 'calibration': return <CalibrationDetail detail={detail} />;
    case 'tournament': return <TournamentDetail detail={detail} />;
    case 'iterativeEditing': return <IterativeEditingDetail detail={detail} />;
    case 'reflection': return <ReflectionDetail detail={detail} />;
    case 'debate': return <DebateDetail detail={detail} />;
    case 'sectionDecomposition': return <SectionDecompositionDetail detail={detail} />;
    case 'evolution': return <EvolutionDetail detail={detail} />;
    case 'treeSearch': return <TreeSearchDetail detail={detail} />;
    case 'outlineGeneration': return <OutlineGenerationDetail detail={detail} />;
    case 'proximity': return <ProximityDetail detail={detail} />;
    case 'metaReview': return <MetaReviewDetail detail={detail} />;
    default: {
      const _exhaustive: never = detail;
      return <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(_exhaustive, null, 2)}</pre>;
    }
  }
}
