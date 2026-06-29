/**
 * Integration tests for the 4-way /initialize branch (Phase 1 of the
 * experiment-analysis project). Exercises the testable extraction
 * scripts/skills/initialize-template-selector.ts directly — the skill spec
 * itself is markdown, so the load-bearing template-selection logic lives in TS.
 *
 * Covers: answer A (No), B (Pattern 1), C (Pattern 2), D (Maybe), and
 * WORKFLOW_BYPASS=true (defaults to "no").
 *
 * Prefixed evolution- so the existing ci.yml integration-evolution matcher
 * picks it up on PR-to-main (not just PR-to-production).
 */

import {
  selectPlanningTemplate,
  selectForBypass,
  EVOLUTION_DOCS_FOR_EXPERIMENTS,
  PRAP_SECTION_TEMPLATE,
  EXPERIMENT_PHASES_STUB,
  MAYBE_CONVERT_NOTE,
} from '../../../scripts/skills/initialize-template-selector';

describe('Evolution /initialize 4-way branch — template selection', () => {
  describe('answer A — No', () => {
    it('produces standard project_kind with no PRAP and no experiment phases', () => {
      const sel = selectPlanningTemplate('no');
      expect(sel.projectKind).toBe('standard');
      expect(sel.prap).toBe(false);
      expect(sel.experimentPhases).toBe(false);
      expect(sel.dropImplementationPhase).toBe(false);
      expect(sel.autoIncludeEvolutionDocs).toBe(false);
      expect(sel.inlineConvertNote).toBe(false);
    });
  });

  describe('answer B — Pattern 1 (feature + experiment)', () => {
    it('produces feature_with_experiment with PRAP + phases + evolution docs, KEEPS Implementation phase', () => {
      const sel = selectPlanningTemplate('pattern1');
      expect(sel.projectKind).toBe('feature_with_experiment');
      expect(sel.prap).toBe(true);
      expect(sel.experimentPhases).toBe(true);
      expect(sel.dropImplementationPhase).toBe(false);
      expect(sel.autoIncludeEvolutionDocs).toBe(true);
    });
  });

  describe('answer C — Pattern 2 (pure validation)', () => {
    it('produces experiment_only with PRAP + phases + evolution docs, DROPS Implementation phase', () => {
      const sel = selectPlanningTemplate('pattern2');
      expect(sel.projectKind).toBe('experiment_only');
      expect(sel.dropImplementationPhase).toBe(true);
      expect(sel.autoIncludeEvolutionDocs).toBe(true);
    });
  });

  describe('answer D — Maybe', () => {
    it('produces standard with inline convert-later note', () => {
      const sel = selectPlanningTemplate('maybe');
      expect(sel.projectKind).toBe('standard');
      expect(sel.inlineConvertNote).toBe(true);
      // No PRAP / no phases — same baseline as "no" except for the note.
      expect(sel.prap).toBe(false);
      expect(sel.experimentPhases).toBe(false);
    });
  });

  describe('WORKFLOW_BYPASS=true', () => {
    it('defaults to the "no" branch (project_kind: standard)', () => {
      const sel = selectForBypass();
      expect(sel).toEqual(selectPlanningTemplate('no'));
    });
  });

  describe('Auto-included evolution docs (Pattern 1 + Pattern 2)', () => {
    it('contains exactly 5 docs in the canonical order', () => {
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toHaveLength(5);
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS[0]).toBe('evolution/docs/strategies_and_experiments.md');
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toContain('evolution/docs/architecture.md');
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toContain('evolution/docs/data_model.md');
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toContain('evolution/docs/arena.md');
      expect(EVOLUTION_DOCS_FOR_EXPERIMENTS).toContain('evolution/docs/rating_and_comparison.md');
    });
  });

  describe('Template fragments are self-consistent', () => {
    it('PRAP section template content would pass prap-validator (contains arms + threshold + named test markers)', () => {
      // The PRAP template is the seed text the user fills in. It must include
      // the markers the validator checks for, so an unfilled but
      // appropriately-shaped template documents the requirement clearly.
      expect(PRAP_SECTION_TEMPLATE).toMatch(/Arms/i);
      expect(PRAP_SECTION_TEMPLATE).toMatch(/threshold/i);
      expect(PRAP_SECTION_TEMPLATE).toMatch(/Mann-Whitney|McNemar|Bootstrap|Spearman|permutation/);
    });

    it('experiment phases stub lists Phases 6 through 10', () => {
      for (const phase of [6, 7, 8, 9, 10]) {
        expect(EXPERIMENT_PHASES_STUB).toMatch(new RegExp(`### Phase ${phase}`));
      }
    });

    it('Maybe convert note references /add_experiment_phases', () => {
      expect(MAYBE_CONVERT_NOTE).toContain('/add_experiment_phases');
    });
  });
});
