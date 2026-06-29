// Helper for /add_experiment_phases — performs the 4 idempotent edits that
// convert a standard project to feature_with_experiment (Decision #17 +
// Phase 2 of the experiment-analysis project plan).
//
// All edits are pure transformations: input strings → output strings. The
// SKILL.md spec wires these into file reads/writes. Tests exercise the
// transformations directly without filesystem.

import {
  EVOLUTION_DOCS_FOR_EXPERIMENTS,
  PRAP_SECTION_TEMPLATE,
  EXPERIMENT_PHASES_STUB,
  type ProjectKind,
} from './initialize-template-selector';

export interface StatusJson {
  branch?: string;
  created_at?: string;
  prerequisites?: Record<string, string>;
  project_kind?: ProjectKind;
  experiment_id?: string | null;
  relevantDocs?: string[];
  analyses?: string[];
  [k: string]: unknown;
}

export interface ConversionPlan {
  planningDocChanged: boolean;
  statusJsonChanged: boolean;
  refusal: string | null;
}

/**
 * Append `## Pre-Registered Analysis Plan` to a planning doc, inserted between
 * `## Options Considered` and `## Phased Execution Plan` if those anchors exist,
 * else appended near the top after `## Background`. Idempotent: no-op if the
 * PRAP header is already present.
 */
export function appendPrapSectionIfAbsent(planningDocText: string): string {
  if (/^## Pre-Registered Analysis Plan$/m.test(planningDocText)) return planningDocText;
  const lines = planningDocText.split('\n');
  // Prefer insertion BEFORE `## Phased Execution Plan`.
  const phaseIdx = lines.findIndex((l) => l.trim() === '## Phased Execution Plan');
  if (phaseIdx !== -1) {
    return [...lines.slice(0, phaseIdx), PRAP_SECTION_TEMPLATE, ...lines.slice(phaseIdx)].join(
      '\n',
    );
  }
  // Fallback: insert at end.
  return planningDocText.replace(/\n*$/, '\n\n') + PRAP_SECTION_TEMPLATE + '\n';
}

/**
 * Append experiment Phases 6-10 stub to `## Phased Execution Plan` if not
 * already present. Detection anchor: `### Phase 6` header.
 */
export function appendExperimentPhasesIfAbsent(planningDocText: string): string {
  if (/^### Phase 6/m.test(planningDocText)) return planningDocText;
  // Insert at end of doc if `## Phased Execution Plan` exists — appends after
  // the last existing phase regardless of count.
  if (/^## Phased Execution Plan$/m.test(planningDocText)) {
    return planningDocText.replace(/\n*$/, '\n') + EXPERIMENT_PHASES_STUB + '\n';
  }
  return planningDocText;
}

/** Union-merge evolution docs into _status.json.relevantDocs without duplicating. */
export function unionEvolutionDocs(status: StatusJson): StatusJson {
  const existing = status.relevantDocs ?? [];
  const merged = [...existing];
  for (const doc of EVOLUTION_DOCS_FOR_EXPERIMENTS) {
    if (!merged.includes(doc)) merged.push(doc);
  }
  return { ...status, relevantDocs: merged };
}

/** Flip _status.json.project_kind from "standard" → "feature_with_experiment". */
export function flipProjectKind(status: StatusJson): StatusJson {
  return { ...status, project_kind: 'feature_with_experiment' };
}

/**
 * Compute a full conversion plan against current state. Refuses (returns a
 * non-null refusal reason) if project_kind is already feature_with_experiment
 * or experiment_only.
 */
export function planConversion(
  planningDocText: string,
  statusJson: StatusJson,
): { newPlanningDoc: string; newStatusJson: StatusJson; plan: ConversionPlan } {
  if (statusJson.project_kind === 'feature_with_experiment') {
    return {
      newPlanningDoc: planningDocText,
      newStatusJson: statusJson,
      plan: {
        planningDocChanged: false,
        statusJsonChanged: false,
        refusal:
          'Project is already feature_with_experiment. /add_experiment_phases is a no-op here.',
      },
    };
  }
  if (statusJson.project_kind === 'experiment_only') {
    return {
      newPlanningDoc: planningDocText,
      newStatusJson: statusJson,
      plan: {
        planningDocChanged: false,
        statusJsonChanged: false,
        refusal:
          'Project is experiment_only (pure validation). /add_experiment_phases applies to standard → feature_with_experiment only.',
      },
    };
  }

  const withPrap = appendPrapSectionIfAbsent(planningDocText);
  const withPhases = appendExperimentPhasesIfAbsent(withPrap);
  const withDocs = unionEvolutionDocs(statusJson);
  const withKind = flipProjectKind(withDocs);

  return {
    newPlanningDoc: withPhases,
    newStatusJson: withKind,
    plan: {
      planningDocChanged: withPhases !== planningDocText,
      statusJsonChanged: JSON.stringify(withKind) !== JSON.stringify(statusJson),
      refusal: null,
    },
  };
}
