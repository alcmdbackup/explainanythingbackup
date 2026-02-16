// Integration test for strategy experiment plan → analyze flow.
// Verifies L8 design generation, mock run injection, and analysis output format.

import {
  generateL8Design,
  mapFactorsToPipelineArgs,
  DEFAULT_ROUND1_FACTORS,
} from '@/lib/experiments/evolution/factorial';
import {
  analyzeExperiment,
  type ExperimentRun,
} from '@/lib/experiments/evolution/analysis';

// ─── L8 Design → Analysis Round-Trip ────────────────────────────

describe('Strategy Experiment Integration', () => {
  const design = generateL8Design(DEFAULT_ROUND1_FACTORS);

  describe('plan → run → analyze flow', () => {
    it('generates 8-run design and produces valid analysis from synthetic results', () => {
      // Step 1: Verify plan generates correct design
      expect(design.runs).toHaveLength(8);
      expect(design.type).toBe('L8');
      expect(Object.keys(design.factors)).toHaveLength(5);

      // Step 2: Create synthetic run results with predictable Elo/cost
      const syntheticRuns: ExperimentRun[] = design.runs.map((run, i) => ({
        row: run.row,
        runId: `synthetic-${run.row}`,
        status: 'completed' as const,
        topElo: 1500 + (i * 50), // Linear Elo progression
        costUsd: 0.50 + (i * 0.30), // Linear cost progression
      }));

      // Step 3: Run analysis
      const result = analyzeExperiment(design, syntheticRuns);

      // Step 4: Verify analysis output structure
      expect(result.completedRuns).toBe(8);
      expect(result.totalRuns).toBe(8);
      expect(result.warnings).toHaveLength(0);

      // Main effects should have entries for all 5 factors
      const factorKeys = Object.keys(design.factors);
      for (const key of factorKeys) {
        expect(result.mainEffects.elo).toHaveProperty(key);
        expect(result.mainEffects.eloPerDollar).toHaveProperty(key);
      }

      // Factor ranking should rank all 5 factors
      expect(result.factorRanking).toHaveLength(5);
      expect(result.factorRanking[0].importance).toBeGreaterThanOrEqual(
        result.factorRanking[4].importance,
      );

      // Should produce at least one recommendation
      expect(result.recommendations.length).toBeGreaterThan(0);

      // Interaction effects should be computed for unassigned columns
      expect(result.interactions).toHaveLength(design.interactionColumns.length);
    });

    it('handles partial data gracefully', () => {
      // Only 4 of 8 runs completed
      const partialRuns: ExperimentRun[] = design.runs.slice(0, 4).map((run) => ({
        row: run.row,
        runId: `partial-${run.row}`,
        status: 'completed' as const,
        topElo: 1600,
        costUsd: 1.00,
      }));
      const pendingRuns: ExperimentRun[] = design.runs.slice(4).map((run) => ({
        row: run.row,
        runId: '',
        status: 'pending' as const,
      }));

      const result = analyzeExperiment(design, [...partialRuns, ...pendingRuns]);
      expect(result.completedRuns).toBe(4);
      expect(result.totalRuns).toBe(8);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('incomplete');
    });
  });

  describe('pipeline args generation', () => {
    it('produces valid pipeline args for each L8 row', () => {
      for (const run of design.runs) {
        const args = run.pipelineArgs;
        expect(args.model).toBeDefined();
        expect(args.judgeModel).toBeDefined();
        expect(args.iterations).toBeGreaterThan(0);
        expect(args.enabledAgents.length).toBeGreaterThan(0);
        // Reflection should always be present
        expect(args.enabledAgents).toContain('reflection');
      }
    });

    it('produces distinct configs across the 8 runs', () => {
      const configs = design.runs.map((r) => JSON.stringify(r.pipelineArgs));
      const unique = new Set(configs);
      // L8 should produce at least 6 distinct configs (some may match by coincidence)
      expect(unique.size).toBeGreaterThanOrEqual(6);
    });

    it('maps factor values correctly for known row', () => {
      // Row 1: all factors at low level (-1)
      const row1 = design.runs[0];
      expect(row1.factors.genModel).toBe('deepseek-chat');
      expect(row1.factors.judgeModel).toBe('gpt-4.1-nano');
      expect(row1.factors.iterations).toBe(3);
      expect(row1.factors.editor).toBe('iterativeEditing');
      expect(row1.factors.supportAgents).toBe('off');
    });
  });
});
