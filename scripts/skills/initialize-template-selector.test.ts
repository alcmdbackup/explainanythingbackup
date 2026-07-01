/**
 * @jest-environment node
 */
// Tests for initialize-template-selector.ts — verifies the 4-way branch of
// /initialize's "controlled experiment?" question maps to the right
// TemplateSelection.

import {
  selectPlanningTemplate,
  selectForBypass,
  buildExperimentPhasesStub,
  EVOLUTION_DOCS_FOR_EXPERIMENTS,
  PRAP_SECTION_TEMPLATE,
  EXPERIMENT_PHASES_STUB,
  EXPERIMENT_PHASES_STUB_WITH_SMOKE,
  MAYBE_CONVERT_NOTE,
} from './initialize-template-selector';

describe('selectPlanningTemplate — 4-way branch', () => {
  it('A. No → standard (no PRAP, no experiment phases, no evolution docs, no smoke)', () => {
    expect(selectPlanningTemplate('no')).toEqual({
      projectKind: 'standard',
      prap: false,
      experimentPhases: false,
      dropImplementationPhase: false,
      autoIncludeEvolutionDocs: false,
      inlineConvertNote: false,
      includeSmokeTest: false,
    });
  });

  it('B. Pattern 1 (feature + experiment) → feature_with_experiment with PRAP + phases + evolution docs, KEEPS Implementation phase', () => {
    expect(selectPlanningTemplate('pattern1')).toEqual({
      projectKind: 'feature_with_experiment',
      prap: true,
      experimentPhases: true,
      dropImplementationPhase: false,
      autoIncludeEvolutionDocs: true,
      inlineConvertNote: false,
      includeSmokeTest: false,
    });
  });

  it('C. Pattern 2 (pure validation) → experiment_only with PRAP + phases + evolution docs, DROPS Implementation phase', () => {
    expect(selectPlanningTemplate('pattern2')).toEqual({
      projectKind: 'experiment_only',
      prap: true,
      experimentPhases: true,
      dropImplementationPhase: true,
      autoIncludeEvolutionDocs: true,
      inlineConvertNote: false,
      includeSmokeTest: false,
    });
  });

  it('D. Maybe → standard but WITH the inline convert-later note (no smoke)', () => {
    expect(selectPlanningTemplate('maybe')).toEqual({
      projectKind: 'standard',
      prap: false,
      experimentPhases: false,
      dropImplementationPhase: false,
      autoIncludeEvolutionDocs: false,
      inlineConvertNote: true,
      includeSmokeTest: false,
    });
  });
});

describe('selectPlanningTemplate — includeSmokeTest flag', () => {
  it('Pattern 1 + smoke → includeSmokeTest:true', () => {
    expect(selectPlanningTemplate('pattern1', true).includeSmokeTest).toBe(true);
  });

  it('Pattern 2 + smoke → includeSmokeTest:true', () => {
    expect(selectPlanningTemplate('pattern2', true).includeSmokeTest).toBe(true);
  });

  it('No + smoke → includeSmokeTest:false (coerced; only meaningful for experiment kinds)', () => {
    expect(selectPlanningTemplate('no', true).includeSmokeTest).toBe(false);
  });

  it('Maybe + smoke → includeSmokeTest:false (coerced)', () => {
    expect(selectPlanningTemplate('maybe', true).includeSmokeTest).toBe(false);
  });

  it('defaults to false when omitted', () => {
    expect(selectPlanningTemplate('pattern1').includeSmokeTest).toBe(false);
    expect(selectPlanningTemplate('pattern2').includeSmokeTest).toBe(false);
  });
});

describe('selectForBypass — WORKFLOW_BYPASS=true defaults to standard', () => {
  it('returns identical selection to "no" branch', () => {
    expect(selectForBypass()).toEqual(selectPlanningTemplate('no'));
  });
});

describe('Template fragments', () => {
  it('EVOLUTION_DOCS_FOR_EXPERIMENTS contains the 5 expected evolution docs', () => {
    expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toEqual([
      'evolution/docs/strategies_and_experiments.md',
      'evolution/docs/architecture.md',
      'evolution/docs/data_model.md',
      'evolution/docs/arena.md',
      'evolution/docs/rating_and_comparison.md',
    ]);
  });

  it('PRAP_SECTION_TEMPLATE includes all required-content markers (arms, threshold, named test)', () => {
    // The PRAP-validator test gate looks for these markers — the template MUST
    // include enough content to pass its own validator when filled in.
    expect(PRAP_SECTION_TEMPLATE).toMatch(/## Pre-Registered Analysis Plan/);
    expect(PRAP_SECTION_TEMPLATE).toMatch(/Arms/i);
    expect(PRAP_SECTION_TEMPLATE).toMatch(/threshold/i);
    expect(PRAP_SECTION_TEMPLATE).toMatch(/Mann-Whitney|McNemar|Bootstrap|Spearman|permutation/);
  });

  it('EXPERIMENT_PHASES_STUB lists Phases 6 through 10 (no smoke split)', () => {
    for (const phase of [6, 7, 8, 9, 10]) {
      expect(EXPERIMENT_PHASES_STUB).toMatch(new RegExp(`### Phase ${phase}`));
    }
    // Sanity: original stub does NOT contain the 7a/7b split.
    expect(EXPERIMENT_PHASES_STUB).not.toMatch(/### Phase 7a/);
    expect(EXPERIMENT_PHASES_STUB).not.toMatch(/### Phase 7b/);
  });

  it('EXPERIMENT_PHASES_STUB_WITH_SMOKE has Phase 7a (smoke) + 7b (full) + Phases 6/8/9/10', () => {
    for (const phase of ['6', '7a', '7b', '8', '9', '10']) {
      expect(EXPERIMENT_PHASES_STUB_WITH_SMOKE).toMatch(new RegExp(`### Phase ${phase}`));
    }
    // Smoke stub includes the smoke-assertion checklist + arena-only wipeout gate.
    expect(EXPERIMENT_PHASES_STUB_WITH_SMOKE).toMatch(/Smoke assertions/);
    expect(EXPERIMENT_PHASES_STUB_WITH_SMOKE).toMatch(/detectArenaOnlyWipeouts/);
    // Should NOT contain a plain `### Phase 7 ` with a trailing space (the non-smoke variant).
    expect(EXPERIMENT_PHASES_STUB_WITH_SMOKE).not.toMatch(/### Phase 7\n/);
  });

  it('buildExperimentPhasesStub(false) === EXPERIMENT_PHASES_STUB', () => {
    expect(buildExperimentPhasesStub(false)).toBe(EXPERIMENT_PHASES_STUB);
  });

  it('buildExperimentPhasesStub(true) === EXPERIMENT_PHASES_STUB_WITH_SMOKE', () => {
    expect(buildExperimentPhasesStub(true)).toBe(EXPERIMENT_PHASES_STUB_WITH_SMOKE);
  });

  it('MAYBE_CONVERT_NOTE references /add_experiment_phases', () => {
    expect(MAYBE_CONVERT_NOTE).toMatch(/\/add_experiment_phases/);
  });
});
