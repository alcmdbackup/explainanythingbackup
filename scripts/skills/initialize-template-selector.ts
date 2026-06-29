// Template-selector for /initialize's 4-way "Will this project involve a
// controlled experiment?" branch (Decision #15). Pure function consumed by the
// /initialize SKILL.md to decide which planning-doc template variant to write.
//
// 4 ProjectKind values:
//   "standard"                — A. No (also Maybe — same template, just with
//                                a pointer to /add_experiment_phases)
//   "feature_with_experiment" — B. Pattern 1 (feature + experiment)
//   "experiment_only"         — C. Pattern 2 (pure validation)

export type ProjectKind = 'standard' | 'feature_with_experiment' | 'experiment_only';
export type BranchAnswer = 'no' | 'pattern1' | 'pattern2' | 'maybe';

export interface TemplateSelection {
  projectKind: ProjectKind;
  /** Include the `## Pre-Registered Analysis Plan` section in `_planning.md`. */
  prap: boolean;
  /** Include experiment Phases 6-10 stubs in `## Phased Execution Plan`. */
  experimentPhases: boolean;
  /** Drop the `## Phased Execution Plan` Implementation phase (Pattern 2 only). */
  dropImplementationPhase: boolean;
  /** Auto-include the 5 evolution docs in `_status.json.relevantDocs`. */
  autoIncludeEvolutionDocs: boolean;
  /** Add an inline note at the end of `## Background` pointing at `/add_experiment_phases`. */
  inlineConvertNote: boolean;
}

/** Evolution docs that should be auto-included in relevantDocs for experiment kinds. */
export const EVOLUTION_DOCS_FOR_EXPERIMENTS = [
  'evolution/docs/strategies_and_experiments.md',
  'evolution/docs/architecture.md',
  'evolution/docs/data_model.md',
  'evolution/docs/arena.md',
  'evolution/docs/rating_and_comparison.md',
];

/** The PRAP section template fragment, inserted between `## Options Considered` and `## Phased Execution Plan`. */
export const PRAP_SECTION_TEMPLATE = `## Pre-Registered Analysis Plan

This section MUST be filled in before \`/run_experiment_analysis\` is invoked. Required content (enforced by \`scripts/skills/prap-validator.ts\` minimum-content gate):

- **Arms:** name + describe each arm (control vs treatment(s)); include strategy IDs once known.
- **Sample size:** N runs/arm planned, justification.
- **Named statistical test:** one of \`Mann-Whitney\`, \`McNemar\`, \`Bootstrap\`, \`Spearman\`, \`permutation\` (or document a non-default with rationale).
- **PASS / FAIL / INCONCLUSIVE thresholds:** exact numbers (e.g. *"PASS iff median tactic-delta ≥ 0 on NEW AND median shift ≥ +5 μ AND Mann-Whitney one-sided p < 0.10"*).
- **Per-arm balance metrics to check:** what counts must roughly match across arms.
- **Judge-decisiveness threshold:** default 0.6 (sourced from \`DECISIVE_CONFIDENCE_THRESHOLD\`).
- **Outlier rule:** defined up front (e.g. *"drop runs with cost > 2× median"*).
- **Multi-criterion aggregation rule** (when applicable): per Decision #14, either name an aggregation rule (e.g. *"PASS iff ≥3 of 5 criteria show median shift ≥ +5 μ"*) or accept per-criterion-only reporting with no aggregate verdict.

`;

/** Experiment phases stub appended to `## Phased Execution Plan` for Pattern 1 / Pattern 2. */
export const EXPERIMENT_PHASES_STUB = `
### Phase 6: Author or update the seed script
- [ ] Place at \`evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts\` (follow \`seedBundleSplitExperiment.ts\` pattern).
- [ ] Add to \`evolution/scripts/experiments/README.md\` index.

### Phase 7: \`/manual_run_experiment\`
- [ ] Dry-run → \`--apply\` on staging; capture printed experiment_id (auto-written to \`_status.json.experiment_id\` per Phase 6 of the experiment-analysis skill).
- [ ] Wait for completion; surface any \`failed\` runs.

### Phase 8: \`/run_experiment_analysis\`
- [ ] Skill runs PRAP gate → balance audit (with arena-only wipeout HARD GATE) → significance → decisiveness → causal-evidence → adversarial 5/5 → writes EAR.md.
- [ ] User reviews EAR.md and approves (or fixes-then-approves).

### Phase 9: \`/write_doc_for_completed_analysis\` (transparent handoff from Phase 8)
- [ ] On approval, /run_experiment_analysis invokes promotion. New \`docs/analysis/<name>/\` folder appears.

### Phase 10: Follow-up PR (script + analysis report)
- [ ] PR title: \`analysis: <experiment short name> A/B results\`
- [ ] Contains the seed script + the analysis folder + planning-doc Artifacts pointer.
`;

/** Inline note appended to `## Background` for the "Maybe" branch (Decision #15.D). */
export const MAYBE_CONVERT_NOTE = `\n> **Note:** If experimental validation becomes needed later, run \`/add_experiment_phases\` to add the PRAP section + experiment phases to this plan.\n`;

/** Map a user's AskUserQuestion answer to a complete TemplateSelection. */
export function selectPlanningTemplate(answer: BranchAnswer): TemplateSelection {
  switch (answer) {
    case 'no':
      return {
        projectKind: 'standard',
        prap: false,
        experimentPhases: false,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: false,
        inlineConvertNote: false,
      };
    case 'pattern1':
      return {
        projectKind: 'feature_with_experiment',
        prap: true,
        experimentPhases: true,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: true,
        inlineConvertNote: false,
      };
    case 'pattern2':
      return {
        projectKind: 'experiment_only',
        prap: true,
        experimentPhases: true,
        dropImplementationPhase: true,
        autoIncludeEvolutionDocs: true,
        inlineConvertNote: false,
      };
    case 'maybe':
      return {
        projectKind: 'standard',
        prap: false,
        experimentPhases: false,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: false,
        inlineConvertNote: true,
      };
  }
}

/** WORKFLOW_BYPASS=true default → standard (no question, no branching). */
export function selectForBypass(): TemplateSelection {
  return selectPlanningTemplate('no');
}

// CLI mode: `npx tsx scripts/skills/initialize-template-selector.ts <answer>`
// Prints JSON TemplateSelection to stdout.
if (require.main === module) {
  const answer = process.argv[2] as BranchAnswer;
  if (!['no', 'pattern1', 'pattern2', 'maybe'].includes(answer)) {
    console.error('Usage: initialize-template-selector.ts {no|pattern1|pattern2|maybe}');
    process.exit(2);
  }
  console.log(JSON.stringify(selectPlanningTemplate(answer)));
  process.exit(0);
}
