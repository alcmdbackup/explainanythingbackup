# rerun_paragraph_recombine_after_bug_fix Plan

## Background

PR #1323 (merged 2026-06-30 13:26 UTC) fixed cross-run paragraph-topic
contamination in `ParagraphRecombineWithCoherencePassAgent`. Pre-fix, every
slot in every run drew from globally-shared topics `[para] 0.P1`, `[para] 1.P2`
etc. — Federal Reserve admin-run variants polluted user-submission Elo signals.
The fix uses `parentVariantId` for the slot topic key, isolating each
submission's slot pool. We need to re-validate the recombine system end-to-end
on a clean (post-fix) Elo signal before drawing conclusions from the prior
A/Bs.

## Requirements

> "We recently fixed a bug in PR 1323 where paragraph recombine was pulling
> from incorrect paragraph pools. Please re-test the different things.
>
> Please use recent strategies run on Federal Reserve 2 to test the
> effectiveness of paragraph recombine on top 3 variants from run. Test out
> coherence pass vs. not, and having a stronger coordinator model, and having
> a stronger coherence pass model. Use experiment analysis skill to analyze,
> it should be present on most recent remote main"

Per AskUserQuestion (2026-06-30): both `paragraph_recombine` (sequential, has
coordinator) AND `paragraph_recombine_with_coherence_pass` (bug-fixed, has
coherence pass) are in scope.

## Problem

The 3 most-recent FR2 coherence-pass A/Bs (CoherencePassPerf, CoherencePassMode,
CoherencePassEnabled) were all bug-affected: their per-slot Elo signals
included foreign Federal Reserve admin-run content as competitors. We cannot
distinguish "the agent is intrinsically worse" from "the agent's slot judge
was systematically biased toward foreign content." The clean re-run answers
that, plus characterizes whether bumping the coordinator model
(paragraph_recombine sequential) or the coherence-pass models
(paragraph_recombine_with_coherence_pass) lifts Elo beyond the baseline.

## Options Considered

- [x] **Option A: 4-arm A/B/C/D on federal_reserve_2** (CHOSEN). Each arm
  varies exactly one knob from a single reference baseline. Maximum
  comparability; one experiment row groups all four arms.
- [ ] **Option B: 2 separate 2-arm experiments** (rejected). Splitting
  `coherence pass on/off` from `stronger models on/off` would double the
  staging-runner queue time without statistical benefit since the prompt +
  seed pipeline are identical.
- [ ] **Option C: Full 2×2×2 factorial** (rejected). 8 arms × N runs/arm
  saturates the staging runner and the experiment budget; the user-specified
  three knobs are correlated (stronger coordinator and stronger coherence
  pass both raise per-token cost), so a one-knob-at-a-time sweep gives
  cleaner isolation per-arm without losing signal.

## Pre-Registered Analysis Plan

> **Per `/run_experiment_analysis` Step 1 PRAP gate** — must be filled in
> BEFORE invoking the analysis skill. Required fields: `arms` + `threshold`
> + a named statistical test (Mann-Whitney / McNemar / Spearman / Bootstrap /
> permutation), per `scripts/skills/prap-validator.ts`.

### Arms

| Arm | Label | Agent | Knob changed | Strategy reuse? |
|---|---|---|---|---|
| **A** | Coherence-Pass-Baseline | `paragraph_recombine_with_coherence_pass` | None (matches `fe314a1e-…`) | YES — `--reuse-existing` |
| **B** | Coherence-Pass-OFF | `paragraph_recombine_with_coherence_pass` | `coherencePassEnabled: false` + `perInvocationCapUsd: 0.10` (matches `0cd27136-…`) | YES — `--reuse-existing` |
| **C** | Sequential-Stronger-Coordinator | `paragraph_recombine` (sequential, NOT coherence pass) | `coordinatorModel: 'gpt-5-mini'` over gemini-flash-lite baseline | NEW strategy |
| **D** | Coherence-Pass-Stronger-Phase-C | `paragraph_recombine_with_coherence_pass` | `coherencePassProposerModel + coherencePassApproverModel: 'gpt-5-mini'` | NEW strategy |

**Reference baseline** for "stronger" picks: `google/gemini-2.5-flash-lite`
across `generationModel` + `judgeModel` (the universal default on FR2
runs to date). "Stronger" = `gpt-5-mini` — the documented "safe lift"
upgrade path for the coordinator role per `evolution/src/lib/schemas.ts:1113`,
applied uniformly across the new arms' upgraded roles.

Identical across all arms: prompt = `federal_reserve_2`, totalBudgetUsd = $0.10,
`qualityCutoff: {topN, 3}` on the recombine iteration, `maxDispatches: 5`,
`rewritesPerParagraph: 5`, `maxComparisonsPerParagraph: 8`,
`maxParagraphsPerInvocation: 12`. Arm-A/B/D iteration shape (generate 30% +
coherence-pass-recombine 70%) matches the existing FR2 baselines verbatim. Arm
C uses the sibling agent `paragraph_recombine` (sequential, with coordinator)
in the recombine iteration slot, otherwise identical.

### Runs per arm

**8 runs/arm × 4 arms = 32 total runs at $0.10/run = $3.20 budget.**
Matches the runs-per-arm of the prior CoherencePassEnabled A/B (8/arm) —
chosen so per-arm n is adequate for the Mann-Whitney test on top-Elo
distribution. Interleaved enqueue across arms (round-robin) to counterbalance
temporal effects (late-day model latency drift, runner-queue ordering).

### Named statistical test

**Mann-Whitney U** (two-sided, α=0.05) on the per-run top-variant final Elo
(top_elo), with arm pairs:
- A vs B (does coherence pass help on the bug-fixed agent?)
- A vs C (does sequential-with-stronger-coordinator beat coherence-pass-with-defaults?)
- A vs D (does stronger Phase C models lift coherence-pass agent Elo?)
- B vs D (does stronger Phase C models lift coherence-pass agent Elo *vs the no-coherence-pass control*?)

Top-Elo is non-normal across runs (occasional high-variance outliers) so
Mann-Whitney is the right rank-based test. With n=8/arm we have power ~0.6
for a 1-σ separation; underpowered relative to a "definitive" study, but
adequate for "did anything move at all" signal.

**Secondary**: per-arm `pct_variants_better_than_seed` density (per
`/run_experiment_analysis` Table A spec) — proportional, throughput-unbiased.

### Threshold (decision rule)

- **PASS** for a knob ⇔ Mann-Whitney p < 0.05 AND median top_elo delta > +10
  Elo points vs the matched control.
- **FAIL** ⇔ Mann-Whitney p ≥ 0.05 OR median top_elo delta < +10.
- **INCONCLUSIVE** ⇔ p < 0.05 AND |median delta| < 10 (statistically significant
  but practically small).

`pct_variants_better_than_seed` density is reported but not part of the
decision rule (informational only — top-Elo density is hard to threshold a
priori on a 4-arm sweep).

### Arena-only wipeout HARD GATE

`/run_experiment_analysis` Step 3 invokes
`evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id <EID>`. Any
arena-only wipeout (run completed + arena_only + 0 variants + 0 cost + 100%
success generations — the 402-credit-exhaustion footprint per
`project_evolution_402_arena_only_wipeout.md` memory) blocks significance
computation until resolved via the AskUserQuestion prompt the skill ships
with.

## Phased Execution Plan

### Phase 1: Author + dry-run seed script
- [ ] Create `evolution/scripts/experiments/seedRerunParagraphRecombineAfterBugFixExperiment_20260630.ts`
      cloning `seedCoherencePassEnabledExperiment_20260627.ts` shape.
- [ ] 4-arm `buildConfig(arm)` factory; Arms A/B match existing
      `fe314a1e`/`0cd27136` configs (so `hashStrategyConfig` produces
      collisions and `--reuse-existing` picks them up).
- [ ] Arms C/D produce new strategies (distinct `config_hash`).
- [ ] Header comment: PR #1323 context + reference strategy ids + chosen
      models + budget per arm.
- [ ] `--target staging` / `--runs-per-arm 8` / `--apply` / `--reuse-existing`
      flags. Production gate behind `--i-know-this-is-prod` (FR2 is
      staging-only per `seedCoherencePassEnabledExperiment_20260627.ts:46`).
- [ ] Update `evolution/scripts/experiments/README.md` Index table.
- [ ] Dry-run prints all 4 strategy hashes + planned run counts.

### Phase 2: Apply + capture experiment_id
- [ ] `--apply --reuse-existing` writes 4 strategies + 1 experiment + 32 runs.
- [ ] Extract `experiment_id` via the skill's `manual-run-experiment-capture.ts`
      helper; write to `_status.json.experiment_id` (idempotent via the
      action enum: write / noop / error).
- [ ] Add `## Artifacts` section here with the printed experiment + strategy ids.

### Phase 3: Wait for completion
- [ ] Poll `evolution_runs` per the manual_run_experiment skill spec until
      `status IN ('pending', 'claimed', 'running')` count = 0 for our EID.
- [ ] If minicomputer hasn't picked up runs within 5 min of seeding, remind
      the user to `git -C ~/Documents/ac/explainanything-worktree0 pull
      --ff-only origin main` (per `project_minicomputer_no_auto_pull.md`
      memory — runner doesn't auto-pull post-merge).
- [ ] Per-arm completion summary (count by status). Surface any `failed`
      runs' `error_code` + `error_message` BEFORE proceeding to analysis.

### Phase 4: Run /run_experiment_analysis
- [ ] Invoke `/run_experiment_analysis rerun_paragraph_recombine_after_bug_fix_evolution_20260630`.
- [ ] The skill reads `experiment_id` from `_status.json`, runs Steps 1–10
      (pre-flight gates → funnel/balance audit → arena-only wipeout HARD
      GATE → Mann-Whitney compute → judge-decisiveness audit →
      causal-evidence pass → EAR write → adversarial 5/5 review →
      user-approval gate → transparent `/write_doc_for_completed_analysis`
      promotion).
- [ ] Approve, fix, or abort at the EAR review gate.

### Phase 5: PR
- [ ] PR contains seed script + README index update + EAR + promoted analysis
      folder + planning doc with Artifacts section.
- [ ] PR title: `analysis: paragraph-recombine bug-fix re-validation A/B results`.
- [ ] PR body references project planning doc + experiment id + arm
      strategy ids + decision-rule outcome (PASS/FAIL/INCONCLUSIVE per arm
      pair) + total cost.

## Testing

### Unit Tests
- [ ] Seed-script dry-run: planned writes match expected (4 strategies, 1
      experiment, 32 runs) — visually verified, no unit-test framework
      coverage (consistent with existing seed scripts; the `apply` path is
      gated behind `--apply` so dry-run is the natural verification).

### Integration Tests
- [ ] None required — the seed script only writes to staging DB via the
      production setup helpers (`upsertStrategy`, `createExperiment`,
      `addRunToExperiment`). All three have existing test coverage.

### E2E Tests
- [ ] None.

### Manual Verification
- [ ] Post-`--apply`, query staging to confirm 4 strategies exist with
      expected `config_hash`es and 32 runs queued against the experiment.
- [ ] After runs complete, spot-check 2 random runs' `evolution_runs.cost_usd`
      to confirm production cost tracking fired (per `manual_run_experiment`
      skill Hard Requirement 1).
- [ ] Spot-check that an Arm A or D run's `evolution_arena_comparisons` rows
      reference per-parent topic names (`[para] <8-char-uuid>.P<n>`), NOT the
      polluted `[para] <digit>.P<n>` pattern. This validates PR #1323 is
      actually in effect.

## Verification

### A) Playwright Verification
- [ ] N/A — no UI changes.

### B) Automated Tests
- [ ] `npm run test:eslint-rules` not needed — seed script doesn't touch
      lint-rule files.
- [ ] Default lint + tsc + build run by /finalize before PR.

## Documentation Updates
- [ ] `evolution/scripts/experiments/README.md` — add seed script to Index table.
- [ ] `docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/` —
      Artifacts section here when ids are known.
- [ ] Post-analysis: `docs/analysis/<promoted-name>/<promoted-name>.md` written
      transparently by `/write_doc_for_completed_analysis`.

## Artifacts

- Seed script: `evolution/scripts/experiments/seedRerunParagraphRecombineAfterBugFixExperiment_20260630.ts`
- Experiment id: `ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6`
- Experiment name: `RerunParagraphRecombineAfterBugFix A/B (federal_reserve_2)`
- Strategy ids:
  - **Arm A (CP-Baseline)**: `fe314a1e-4894-4765-9162-8bf51c827dbc` (reused — "Strategy 7a494f (lite, 2it)")
  - **Arm B (CP-Off)**: `0cd27136-b14a-408a-b7f6-635983c66bb6` (reused — "Strategy 66f213 (lite, 2it)")
  - **Arm C (Sequential-Stronger-Coordinator)**: `3e967467-c0ed-405e-9f7c-5d00bdab554e` (NEW; config_hash `v2:578ddb9e4…`)
  - **Arm D (CP-Stronger-Phase-C)**: `d09d25a1-9f0a-46aa-be26-8a0c94848749` (NEW; config_hash `v2:2f2de151f…`)
- Runs enqueued: 32 (4 arms × 8/arm, $0.10/run = $3.20 total budget cap)
- Apply timestamp: 2026-06-30T13:51 UTC
- Post-EAR-approval analysis path: _(TBD by `/write_doc_for_completed_analysis`)_

## Review & Discussion

_(Populated by `/plan-review` if invoked.)_
