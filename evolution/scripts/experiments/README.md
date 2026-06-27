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
