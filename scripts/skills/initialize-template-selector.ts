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
  /** Split Phase 7 into 7a (smoke tranche) + 7b (full tranche) with smoke-assertion checklist.
   *  Only meaningful when `experimentPhases: true`. Always `false` for non-experiment kinds. */
  includeSmokeTest: boolean;
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

/** Experiment phases stub appended to `## Phased Execution Plan` for Pattern 1 / Pattern 2 (no smoke test). */
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

/** Experiment phases stub with a smoke-tranche split (Phase 7a → 7b) for Pattern 1 / Pattern 2. */
export const EXPERIMENT_PHASES_STUB_WITH_SMOKE = `
### Phase 6: Author or update the seed script
- [ ] Place at \`evolution/scripts/experiments/seed<Name>Experiment_YYYYMMDD.ts\` (follow \`seedBundleSplitExperiment.ts\` pattern).
- [ ] Support \`--runs N\` so a small smoke tranche (default 2) can queue first, followed by the full tranche once smoke passes.
- [ ] Add to \`evolution/scripts/experiments/README.md\` index.

### Phase 7a: Smoke tranche (small N, e.g. 2 runs) — MUST pass before Phase 7b
- [ ] \`/manual_run_experiment\` dry-run → \`--apply --runs 2\` on staging; capture printed experiment_id + strategy_id (auto-written to \`_status.json.experiment_id\` per Phase 6 of the experiment-analysis skill).
- [ ] Wait for the smoke runs to reach \`completed\` or \`failed\` (typical: ~5-15 min per run under minicomputer concurrency=5).
- [ ] **Smoke assertions (ALL must pass):**
  - [ ] All smoke runs reach \`status = 'completed'\` (no \`failed\`, no stuck \`claimed\` past 10 min).
  - [ ] \`run_summary->>'stopReason'\` is NOT \`arena_only\` for any smoke run (arena-only wipeout HARD GATE — typically means provider credit exhaustion or 402).
  - [ ] Each smoke run produces the agent invocations expected for its \`agentType\` (e.g. the wrapper's marker \`agent_name\` in \`evolution_agent_invocations\` plus inner \`generation\`/\`ranking\` calls).
  - [ ] Cost tracking is working: \`SELECT SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id IN (<smoke runs>)\` > 0 and within 1.5× of the projected per-run budget.
  - [ ] At least 1 variant produced per smoke run (\`variant_kind='article'\` for article experiments).
  - [ ] Arena-only wipeout detector: \`evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id <EID> --json\` returns \`count: 0\` for the smoke run IDs.
- [ ] If any smoke assertion fails: STOP, root-cause, fix, and re-run fresh smoke runs before proceeding. Do NOT queue the full tranche on a broken setup.

### Phase 7b: Full tranche (remaining N) — only after Phase 7a passes
- [ ] \`/manual_run_experiment\` re-invocation with \`--apply --runs <remaining>\` on staging (same seed script, same experiment, same strategy_id).
- [ ] Wait for completion; surface any \`failed\` runs immediately (fingerprint: \`arena_only\` stopReason + \`error_code = 'all_generations_failed'\` → arena-only wipeout).
- [ ] Manual sanity check on 1 additional completed run: confirm invocation-shape + variant behavior matches Phase 7a.

### Phase 8: \`/run_experiment_analysis\`
- [ ] Skill runs PRAP gate → balance audit (with arena-only wipeout HARD GATE) → significance → decisiveness → causal-evidence → adversarial 5/5 → writes EAR.md.
- [ ] User reviews EAR.md and approves (or fixes-then-approves).

### Phase 9: \`/write_doc_for_completed_analysis\` (transparent handoff from Phase 8)
- [ ] On approval, /run_experiment_analysis invokes promotion. New \`docs/analysis/<name>/\` folder appears.

### Phase 10: Follow-up PR (script + analysis report)
- [ ] PR title: \`analysis: <experiment short name> A/B results\`
- [ ] Contains the seed script + the analysis folder + planning-doc Artifacts pointer.
`;

/** Pick the right experiment-phases stub based on the smoke-test flag. */
export function buildExperimentPhasesStub(includeSmokeTest: boolean): string {
  return includeSmokeTest ? EXPERIMENT_PHASES_STUB_WITH_SMOKE : EXPERIMENT_PHASES_STUB;
}

/** Inline note appended to `## Background` for the "Maybe" branch (Decision #15.D). */
export const MAYBE_CONVERT_NOTE = `\n> **Note:** If experimental validation becomes needed later, run \`/add_experiment_phases\` to add the PRAP section + experiment phases to this plan.\n`;

/** Map a user's AskUserQuestion answer to a complete TemplateSelection.
 *  `includeSmokeTest` is only meaningful when `answer` selects an experiment kind
 *  (`pattern1` or `pattern2`) — it is silently coerced to `false` for other branches. */
export function selectPlanningTemplate(
  answer: BranchAnswer,
  includeSmokeTest = false,
): TemplateSelection {
  switch (answer) {
    case 'no':
      return {
        projectKind: 'standard',
        prap: false,
        experimentPhases: false,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: false,
        inlineConvertNote: false,
        includeSmokeTest: false,
      };
    case 'pattern1':
      return {
        projectKind: 'feature_with_experiment',
        prap: true,
        experimentPhases: true,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: true,
        inlineConvertNote: false,
        includeSmokeTest,
      };
    case 'pattern2':
      return {
        projectKind: 'experiment_only',
        prap: true,
        experimentPhases: true,
        dropImplementationPhase: true,
        autoIncludeEvolutionDocs: true,
        inlineConvertNote: false,
        includeSmokeTest,
      };
    case 'maybe':
      return {
        projectKind: 'standard',
        prap: false,
        experimentPhases: false,
        dropImplementationPhase: false,
        autoIncludeEvolutionDocs: false,
        inlineConvertNote: true,
        includeSmokeTest: false,
      };
  }
}

/** WORKFLOW_BYPASS=true default → standard (no question, no branching). */
export function selectForBypass(): TemplateSelection {
  return selectPlanningTemplate('no');
}

// CLI mode: `npx tsx scripts/skills/initialize-template-selector.ts <answer> [smoke]`
// Prints JSON TemplateSelection to stdout. Pass a second arg `smoke` (or `true`) to
// enable the Phase 7 smoke-tranche split for experiment kinds.
if (require.main === module) {
  const answer = process.argv[2] as BranchAnswer;
  const smokeArg = (process.argv[3] || '').toLowerCase();
  const includeSmokeTest = smokeArg === 'smoke' || smokeArg === 'true' || smokeArg === '1';
  if (!['no', 'pattern1', 'pattern2', 'maybe'].includes(answer)) {
    console.error('Usage: initialize-template-selector.ts {no|pattern1|pattern2|maybe} [smoke]');
    process.exit(2);
  }
  console.log(JSON.stringify(selectPlanningTemplate(answer, includeSmokeTest)));
  process.exit(0);
}
