# Analyze Performance Self Critique Agent Plan

## Background
Run an experiment to analyze and understand performance of self critique driven agent.

Context (auto-captured): the `SelfCritiqueReviseAgent` (marker tactic `self_critique_driven`, agent type `self_critique_revise`) was just landed by the sibling project `brainstorm_new_agents_with_reflection_20260630`. It is a wrapper agent — one reflection LLM call producing free-form `ChangeKind + Summary + Plan`, then GFPA delegation with the plan as a nonce-fenced customPrompt. Expected cost stack ~$0.005/variant (~1× GFPA + ~15% reflection premium). This project runs a controlled experiment on the evolution pipeline to measure whether that premium buys real Elo gains vs a plain-GFPA baseline.

## Requirements (from GH Issue #NNN)
Same as summary.

## Problem
[3-5 sentences describing the problem — refine after /research]

The SelfCritiqueReviseAgent adds a reflection LLM call before every generate, roughly a 15% cost premium per variant. Without a controlled experiment we do not know whether the reflection buys enough Elo improvement to justify the extra cost. Nor do we know how it behaves in the high-Elo regime where the reflector receives an extra "you're already strong" hint (`SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300`).

## Options Considered
- [ ] **Option A: Head-to-head A/B against `generate`**: two-arm experiment — treatment strategy uses `agentType: 'self_critique_revise'` on every iteration; control uses `agentType: 'generate'` with the same generation/judge models, same total budget per run, same prompt set. Primary metric: final winner Elo. Secondary: total cost, eloPerDollar, above-1300 sub-population Elo.
- [ ] **Option B: Three-arm A/B/C also including `reflect_and_generate`**: adds the pre-existing reflection wrapper (`agentType: 'reflect_and_generate'`) as an intermediate arm. Tests whether the free-form reflection specifically (vs the constrained tactic-picker reflection) is what earns the premium.
- [ ] **Option C: Within-strategy interleave (single arm)**: mixed strategy that alternates `self_critique_revise` and `generate` iterations. Isolates iteration-level tactic effectiveness rather than run-level winner-Elo effect. Cheaper but weaker external validity.

## Pre-Registered Analysis Plan

This section MUST be filled in before `/run_experiment_analysis` is invoked. Required content (enforced by `scripts/skills/prap-validator.ts` minimum-content gate):

- **Arms:** name + describe each arm (control vs treatment(s)); include strategy IDs once known.
- **Sample size:** N runs/arm planned, justification.
- **Named statistical test:** one of `Mann-Whitney`, `McNemar`, `Bootstrap`, `Spearman`, `permutation` (or document a non-default with rationale).
- **PASS / FAIL / INCONCLUSIVE thresholds:** exact numbers (e.g. *"PASS iff median tactic-delta ≥ 0 on NEW AND median shift ≥ +5 μ AND Mann-Whitney one-sided p < 0.10"*).
- **Per-arm balance metrics to check:** what counts must roughly match across arms.
- **Judge-decisiveness threshold:** default 0.6 (sourced from `DECISIVE_CONFIDENCE_THRESHOLD`).
- **Outlier rule:** defined up front (e.g. *"drop runs with cost > 2× median"*).
- **Multi-criterion aggregation rule** (when applicable): per Decision #14, either name an aggregation rule (e.g. *"PASS iff ≥3 of 5 criteria show median shift ≥ +5 μ"*) or accept per-criterion-only reporting with no aggregate verdict.

## Phased Execution Plan

### Phase 6: Author or update the seed script
- [ ] Place at `evolution/scripts/experiments/seedSelfCritiquePerfExperiment_20260630.ts` (follow `seedBundleSplitExperiment.ts` pattern).
- [ ] Add to `evolution/scripts/experiments/README.md` index.

### Phase 7: `/manual_run_experiment`
- [ ] Dry-run → `--apply` on staging; capture printed experiment_id (auto-written to `_status.json.experiment_id` per Phase 6 of the experiment-analysis skill).
- [ ] Wait for completion; surface any `failed` runs.

### Phase 8: `/run_experiment_analysis`
- [ ] Skill runs PRAP gate → balance audit (with arena-only wipeout HARD GATE) → significance → decisiveness → causal-evidence → adversarial 5/5 → writes EAR.md.
- [ ] User reviews EAR.md and approves (or fixes-then-approves).

### Phase 9: `/write_doc_for_completed_analysis` (transparent handoff from Phase 8)
- [ ] On approval, /run_experiment_analysis invokes promotion. New `docs/analysis/<name>/` folder appears.

### Phase 10: Follow-up PR (script + analysis report)
- [ ] PR title: `analysis: self-critique agent performance A/B results`
- [ ] Contains the seed script + the analysis folder + planning-doc Artifacts pointer.

## Testing

### Unit Tests
- [ ] N/A for pure validation — no new production code. Any helper scripts written under `evolution/scripts/experiments/` follow the existing seed-script conventions (idempotent, dry-run default).

### Integration Tests
- [ ] N/A for pure validation.

### E2E Tests
- [ ] N/A for pure validation.

### Manual Verification
- [ ] Dry-run of seed script prints intended strategies + runs and does NOT write to DB.
- [ ] `--apply` on staging inserts pending runs; minicomputer claims them within one systemd-timer tick.
- [ ] Sanity-check a single run's `agent_name` column values in `evolution_agent_invocations` for the treatment arm (expect `self_critique` on the reflection call + `generation`/`ranking` inside GFPA).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes.

### B) Automated Tests
- [ ] N/A — pure validation project. Verification is via the EAR (`/run_experiment_analysis` output) that Phase 8 produces.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/strategies_and_experiments.md` — no expected update; reference only.
- [ ] `evolution/docs/architecture.md` — no expected update; reference only.
- [ ] `evolution/docs/data_model.md` — no expected update; reference only.
- [ ] `evolution/docs/arena.md` — no expected update; reference only.
- [ ] `evolution/docs/rating_and_comparison.md` — no expected update; reference only.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — no expected update; reference only.
- [ ] `docs/feature_deep_dives/llm_spending_gate.md` — no expected update; reference only.
- [ ] `docs/docs_overall/llm_provider_limits.md` — no expected update; reference only.
- [ ] `evolution/docs/agents/overview.md` § SelfCritiqueReviseAgent — MAY want a "See also: performance analysis at docs/analysis/<name>/" pointer after Phase 9 promotes the EAR.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
