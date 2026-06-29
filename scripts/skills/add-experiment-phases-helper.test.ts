/**
 * @jest-environment node
 */
// Tests for add-experiment-phases-helper.ts — verifies the 4 idempotent edits
// + refusal on already-converted projects. Exercises pure transformations,
// no filesystem.

import {
  appendPrapSectionIfAbsent,
  appendExperimentPhasesIfAbsent,
  unionEvolutionDocs,
  flipProjectKind,
  planConversion,
  type StatusJson,
} from './add-experiment-phases-helper';

const STANDARD_PLAN = `# Foo Plan

## Background
foo

## Options Considered
- [ ] Option A

## Phased Execution Plan

### Phase 1: Build
- [ ] thing

### Phase 2: Test
- [ ] thing
`;

const STANDARD_STATUS: StatusJson = {
  branch: 'feat/foo_20260628',
  created_at: '2026-06-28T00:00:00Z',
  prerequisites: {},
  project_kind: 'standard',
  experiment_id: null,
  relevantDocs: ['docs/docs_overall/architecture.md'],
  analyses: [],
};

describe('appendPrapSectionIfAbsent — idempotent PRAP insert', () => {
  it('inserts PRAP section before `## Phased Execution Plan`', () => {
    const out = appendPrapSectionIfAbsent(STANDARD_PLAN);
    expect(out).toMatch(/## Pre-Registered Analysis Plan/);
    // Ordering: PRAP must come before Phased Execution Plan.
    const prapIdx = out.indexOf('## Pre-Registered Analysis Plan');
    const phaseIdx = out.indexOf('## Phased Execution Plan');
    expect(prapIdx).toBeGreaterThan(-1);
    expect(phaseIdx).toBeGreaterThan(prapIdx);
  });

  it('is a no-op if PRAP header is already present', () => {
    const planWithPrap = appendPrapSectionIfAbsent(STANDARD_PLAN);
    const twice = appendPrapSectionIfAbsent(planWithPrap);
    expect(twice).toBe(planWithPrap);
  });

  it('falls back to end-of-doc append when `## Phased Execution Plan` is absent', () => {
    const noPhases = `# Plan\n\n## Background\nfoo`;
    const out = appendPrapSectionIfAbsent(noPhases);
    expect(out).toMatch(/## Pre-Registered Analysis Plan/);
  });
});

describe('appendExperimentPhasesIfAbsent — idempotent Phases 6-10 insert', () => {
  it('appends Phases 6-10 stub after existing phases', () => {
    const out = appendExperimentPhasesIfAbsent(STANDARD_PLAN);
    for (const phase of [6, 7, 8, 9, 10]) {
      expect(out).toMatch(new RegExp(`### Phase ${phase}`));
    }
    // Existing Phase 1 + Phase 2 still present.
    expect(out).toMatch(/### Phase 1: Build/);
    expect(out).toMatch(/### Phase 2: Test/);
  });

  it('is a no-op if Phase 6 header is already present', () => {
    const planWithPhases = appendExperimentPhasesIfAbsent(STANDARD_PLAN);
    const twice = appendExperimentPhasesIfAbsent(planWithPhases);
    expect(twice).toBe(planWithPhases);
  });

  it('is a no-op when `## Phased Execution Plan` section is absent (no anchor)', () => {
    const noPhases = `# Plan\n\n## Background\nfoo`;
    expect(appendExperimentPhasesIfAbsent(noPhases)).toBe(noPhases);
  });
});

describe('unionEvolutionDocs — set-union into relevantDocs', () => {
  it('adds the 5 evolution docs when none are present', () => {
    const out = unionEvolutionDocs(STANDARD_STATUS);
    for (const doc of [
      'evolution/docs/strategies_and_experiments.md',
      'evolution/docs/architecture.md',
      'evolution/docs/data_model.md',
      'evolution/docs/arena.md',
      'evolution/docs/rating_and_comparison.md',
    ]) {
      expect(out.relevantDocs).toContain(doc);
    }
    // Pre-existing entry is preserved.
    expect(out.relevantDocs).toContain('docs/docs_overall/architecture.md');
  });

  it('does NOT duplicate when called twice', () => {
    const once = unionEvolutionDocs(STANDARD_STATUS);
    const twice = unionEvolutionDocs(once);
    expect(twice.relevantDocs).toEqual(once.relevantDocs);
  });

  it('handles missing relevantDocs (initializes to empty array first)', () => {
    const noDocsStatus = { ...STANDARD_STATUS, relevantDocs: undefined };
    const out = unionEvolutionDocs(noDocsStatus);
    expect(out.relevantDocs).toHaveLength(5);
  });
});

describe('flipProjectKind', () => {
  it('flips standard → feature_with_experiment', () => {
    expect(flipProjectKind(STANDARD_STATUS).project_kind).toBe('feature_with_experiment');
  });

  it('preserves all other fields', () => {
    const out = flipProjectKind(STANDARD_STATUS);
    expect(out.branch).toBe(STANDARD_STATUS.branch);
    expect(out.created_at).toBe(STANDARD_STATUS.created_at);
    expect(out.experiment_id).toBe(STANDARD_STATUS.experiment_id);
  });
});

describe('planConversion — end-to-end orchestration', () => {
  it('converts a fresh standard project (all 4 edits land)', () => {
    const { newPlanningDoc, newStatusJson, plan } = planConversion(STANDARD_PLAN, STANDARD_STATUS);
    expect(plan.refusal).toBeNull();
    expect(plan.planningDocChanged).toBe(true);
    expect(plan.statusJsonChanged).toBe(true);
    expect(newPlanningDoc).toMatch(/## Pre-Registered Analysis Plan/);
    expect(newPlanningDoc).toMatch(/### Phase 6/);
    expect(newStatusJson.project_kind).toBe('feature_with_experiment');
    expect(newStatusJson.relevantDocs).toContain('evolution/docs/strategies_and_experiments.md');
  });

  it('is idempotent: second invocation produces no further changes', () => {
    const first = planConversion(STANDARD_PLAN, STANDARD_STATUS);
    // After first conversion, project_kind is feature_with_experiment.
    // planConversion refuses on already-converted, so second call returns the
    // refusal path with no changes.
    const second = planConversion(first.newPlanningDoc, first.newStatusJson);
    expect(second.plan.refusal).toMatch(/already feature_with_experiment/);
    expect(second.plan.planningDocChanged).toBe(false);
    expect(second.plan.statusJsonChanged).toBe(false);
  });

  it('refuses on already-converted feature_with_experiment projects', () => {
    const converted: StatusJson = { ...STANDARD_STATUS, project_kind: 'feature_with_experiment' };
    const out = planConversion(STANDARD_PLAN, converted);
    expect(out.plan.refusal).toMatch(/already feature_with_experiment/);
  });

  it('refuses on experiment_only projects (pure validation, different shape)', () => {
    const expOnly: StatusJson = { ...STANDARD_STATUS, project_kind: 'experiment_only' };
    const out = planConversion(STANDARD_PLAN, expOnly);
    expect(out.plan.refusal).toMatch(/experiment_only/);
  });
});
