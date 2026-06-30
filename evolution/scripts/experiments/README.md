# Evolution Experiments — Seed Scripts

A/B and multi-arm experiment seed scripts for staging/production. Each script in
this folder creates strategies + an `evolution_experiments` row + queues runs
through the production pipeline so the minicomputer evolution-runner picks them
up with full cost tracking via `llmCallTracking`.

## Conventions

- File name: `seed<ExperimentName>Experiment.ts`.
- Each script supports `--target {staging|prod}`, `--runs-per-arm N`, `--apply`,
  `--append`, and `--reuse-existing` flags (the production seeder pattern; see
  `seedBundleSplitExperiment.ts` in the parent `scripts/` folder for the
  original).
- Cost tracking is automatic — queued runs flow through
  `createEvolutionLLMClient` → `recordSpend` → `llmCallTracking` rows.
- For staging-only prompts (e.g. `federal_reserve_2`), the script must gate
  `--target prod` behind `--i-know-this-is-prod` to prevent accidental writes.

## Index

| Script | Experiment | Project | Date |
|---|---|---|---|
| `seedCoherencePassPerformanceExperiment_20260624.ts` | CoherencePassPerf A/B (federal_reserve_2) | [`investigate_paragraph_recombine_coherence_pass_performance_20260623`](../../../docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/) | 2026-06-24 |
| `seedCoherencePassModeABExperiment_20260626.ts` | CoherencePassMode A/B (federal_reserve_2) — Mode A pinned vs Mode B default | [`rebuild_coherence_pass_agent_mode_ab_configurable_20260624`](../../../docs/planning/rebuild_coherence_pass_agent_mode_ab_configurable_20260624/) | 2026-06-26 |
| `seedEloAgentComparisonExperiment_20260626.ts` | 9-agent comparison on a single ~1325-Elo seed (new isolated arena, 2 seed rows) | [`design_elo_improvement_experiment_20260626`](../../../docs/planning/design_elo_improvement_experiment_20260626/) | 2026-06-26 |
| `seedCoherencePassEnabledExperiment_20260627.ts` | CoherencePassEnabled A/B (federal_reserve_2) — Phase C ON (Mode B) vs OFF | [`rebuild_coherence_pass_agent_mode_ab_configurable_20260624`](../../../docs/planning/rebuild_coherence_pass_agent_mode_ab_configurable_20260624/) (Phase 7 follow-up) | 2026-06-27 |
| `seedRerunParagraphRecombineAfterBugFixExperiment_20260630.ts` | RerunParagraphRecombineAfterBugFix A/B/C/D (federal_reserve_2) — 4 arms revalidating PR #1323 fix + stronger coordinator/proposer/approver model sweeps | [`rerun_paragraph_recombine_after_bug_fix_evolution_20260630`](../../../docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/) | 2026-06-30 |
