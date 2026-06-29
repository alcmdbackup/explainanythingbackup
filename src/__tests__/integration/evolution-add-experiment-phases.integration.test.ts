/**
 * Integration tests for /add_experiment_phases (Phase 2 + Phase 1.5 of the
 * experiment-analysis project). Exercises the testable extraction
 * scripts/skills/add-experiment-phases-helper.ts against fixture project
 * skeletons written to $TMPDIR.
 *
 * Covers: 4 idempotent edits, second-run no-op, refusal on already-converted
 * + experiment_only projects.
 *
 * Prefixed evolution- so the existing ci.yml integration-evolution matcher
 * picks it up on PR-to-main.
 */

import {
  planConversion,
  appendPrapSectionIfAbsent,
  appendExperimentPhasesIfAbsent,
  unionEvolutionDocs,
  flipProjectKind,
  type StatusJson,
} from '../../../scripts/skills/add-experiment-phases-helper';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const FIXTURE_PLAN_STANDARD = `# Foo Plan

## Background
foo

## Options Considered
- [ ] Option A

## Phased Execution Plan

### Phase 1: Build
- [ ] thing
`;

const FIXTURE_STATUS_STANDARD: StatusJson = {
  branch: 'feat/foo_20260628',
  created_at: '2026-06-28T00:00:00Z',
  prerequisites: {},
  project_kind: 'standard',
  experiment_id: null,
  relevantDocs: ['docs/docs_overall/architecture.md'],
  analyses: [],
};

describe('Evolution /add_experiment_phases — conversion helper', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-exp-phases-itest-'));
  });

  afterAll(() => {
    // Cleanup fixtures from $TMPDIR (per testing_overview Rule 11 / scratchpad hygiene).
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('4 idempotent edits on a fresh standard project', () => {
    it('all 4 edits land + planning doc + status are mutated as expected', () => {
      const { newPlanningDoc, newStatusJson, plan } = planConversion(
        FIXTURE_PLAN_STANDARD,
        FIXTURE_STATUS_STANDARD,
      );
      expect(plan.refusal).toBeNull();
      expect(plan.planningDocChanged).toBe(true);
      expect(plan.statusJsonChanged).toBe(true);

      // Edit 1: PRAP section appended
      expect(newPlanningDoc).toMatch(/## Pre-Registered Analysis Plan/);
      // ...inserted BEFORE ## Phased Execution Plan
      expect(newPlanningDoc.indexOf('## Pre-Registered Analysis Plan'))
        .toBeLessThan(newPlanningDoc.indexOf('## Phased Execution Plan'));

      // Edit 2: Phases 6-10 appended
      for (const phase of [6, 7, 8, 9, 10]) {
        expect(newPlanningDoc).toMatch(new RegExp(`### Phase ${phase}`));
      }

      // Edit 3: 5 evolution docs union-added to relevantDocs
      expect(newStatusJson.relevantDocs).toContain('evolution/docs/strategies_and_experiments.md');
      expect(newStatusJson.relevantDocs).toContain('evolution/docs/architecture.md');
      expect(newStatusJson.relevantDocs).toContain('evolution/docs/data_model.md');
      expect(newStatusJson.relevantDocs).toContain('evolution/docs/arena.md');
      expect(newStatusJson.relevantDocs).toContain('evolution/docs/rating_and_comparison.md');
      // Pre-existing entry preserved
      expect(newStatusJson.relevantDocs).toContain('docs/docs_overall/architecture.md');

      // Edit 4: project_kind flipped
      expect(newStatusJson.project_kind).toBe('feature_with_experiment');
      // Other fields preserved
      expect(newStatusJson.branch).toBe(FIXTURE_STATUS_STANDARD.branch);
      expect(newStatusJson.created_at).toBe(FIXTURE_STATUS_STANDARD.created_at);
      expect(newStatusJson.experiment_id).toBeNull();
    });
  });

  describe('Idempotency — second invocation is a no-op (via refusal)', () => {
    it('refuses on already-converted feature_with_experiment + no further changes', () => {
      // Run conversion once.
      const first = planConversion(FIXTURE_PLAN_STANDARD, FIXTURE_STATUS_STANDARD);
      // Run again on the result — project_kind is now feature_with_experiment.
      const second = planConversion(first.newPlanningDoc, first.newStatusJson);
      expect(second.plan.refusal).toMatch(/already feature_with_experiment/);
      expect(second.plan.planningDocChanged).toBe(false);
      expect(second.plan.statusJsonChanged).toBe(false);
    });

    it('individual edit fns are also idempotent (defense in depth)', () => {
      const withPrap = appendPrapSectionIfAbsent(FIXTURE_PLAN_STANDARD);
      expect(appendPrapSectionIfAbsent(withPrap)).toBe(withPrap);

      const withPhases = appendExperimentPhasesIfAbsent(FIXTURE_PLAN_STANDARD);
      expect(appendExperimentPhasesIfAbsent(withPhases)).toBe(withPhases);

      const withDocs = unionEvolutionDocs(FIXTURE_STATUS_STANDARD);
      expect(unionEvolutionDocs(withDocs).relevantDocs).toEqual(withDocs.relevantDocs);

      // flipProjectKind is unconditional (helper-level) — guard happens at planConversion.
      const flipped = flipProjectKind(FIXTURE_STATUS_STANDARD);
      expect(flipped.project_kind).toBe('feature_with_experiment');
    });
  });

  describe('Refusal on experiment_only projects (different shape, not convertible)', () => {
    it('refuses with a message naming experiment_only', () => {
      const expOnlyStatus: StatusJson = { ...FIXTURE_STATUS_STANDARD, project_kind: 'experiment_only' };
      const out = planConversion(FIXTURE_PLAN_STANDARD, expOnlyStatus);
      expect(out.plan.refusal).toMatch(/experiment_only/);
      expect(out.plan.planningDocChanged).toBe(false);
      expect(out.plan.statusJsonChanged).toBe(false);
    });
  });

  describe('End-to-end fixture write (no DB; pure filesystem)', () => {
    it('writes converted files to $TMPDIR and round-trips via fs.readFileSync', () => {
      const projectDir = path.join(tempDir, 'docs/planning/foo_20260628');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, '_planning.md'), FIXTURE_PLAN_STANDARD);
      fs.writeFileSync(path.join(projectDir, '_status.json'), JSON.stringify(FIXTURE_STATUS_STANDARD, null, 2));

      // Read, convert, write — exactly what the skill spec invokes.
      const planText = fs.readFileSync(path.join(projectDir, '_planning.md'), 'utf8');
      const statusJson: StatusJson = JSON.parse(fs.readFileSync(path.join(projectDir, '_status.json'), 'utf8'));
      const { newPlanningDoc, newStatusJson, plan } = planConversion(planText, statusJson);
      expect(plan.refusal).toBeNull();
      fs.writeFileSync(path.join(projectDir, '_planning.md'), newPlanningDoc);
      fs.writeFileSync(path.join(projectDir, '_status.json'), JSON.stringify(newStatusJson, null, 2));

      // Round-trip verification.
      const updatedPlan = fs.readFileSync(path.join(projectDir, '_planning.md'), 'utf8');
      const updatedStatus = JSON.parse(fs.readFileSync(path.join(projectDir, '_status.json'), 'utf8'));
      expect(updatedPlan).toMatch(/## Pre-Registered Analysis Plan/);
      expect(updatedPlan).toMatch(/### Phase 10/);
      expect(updatedStatus.project_kind).toBe('feature_with_experiment');
    });
  });
});
