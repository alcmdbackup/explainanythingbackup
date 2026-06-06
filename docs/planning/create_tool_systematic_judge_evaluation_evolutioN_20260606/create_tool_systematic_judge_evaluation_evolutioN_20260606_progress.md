# Create Tool Systematic Judge Evaluation (Evolution) Progress

## Phase 0: Research & Methodology Recovery
### Work Done
- Project initialized via /initialize. Read ALL judge-critical docs in full (rating_and_comparison, arena, data_model, agents/overview, strategies_and_experiments, visualization, logging, metrics, architecture, reference + both `docs/research/` agreement docs).
- Ran a 20-agent / 5-round research workflow (`judge-eval-research`, wf_e80379c2-165): recovered the historical methodology (run 140f7bce pair-bank, model×temp sweep, implied-beta back-solve), located the lost scripts on unmerged branch `feat/estimate_match_noise_evolution_20260411` (SHA 65730bc6, issue #959 OPEN), and mapped the live judge code (compareWithBiasMitigation `:478`, decisive_rate=conf>0.6 `finalization.ts:83-86`, temp hard-forced 0 `createEvolutionLLMClient.ts:146-148`).
- **Key discovery**: PR #1168 "Match Viewer" merged today (`23230ece`) — provides the interactive re-judge sandbox + custom-prompt seam + reasoning parser (display-only, persists nothing). **Rebased this branch onto `origin/main` (`838d2956`)** so we build on it. Our project = the persistence + batch-measurement layer on top.
- Designed the 3-table storage (`judge_eval_pair_banks/runs/calls` + leaderboard VIEW), the metric set, and the Option C plan. Wrote findings to `_research.md`, plan to `_planning.md`.

### Issues Encountered
- Local `origin/main` was stale (`970bd6d9`) — the workflow's completeness critic caught the #1168 merge; verified + rebased.
- 1 of 20 workflow agents (git-forensics) failed to return structured output; covered by sibling agents.
- Data quirk: historical pair-bank's variant D shares B's UUID (`2f25e2b0`) — pair-bank seeding must fix the close-pair labeling.

### User Clarifications
- Scope = **arena pairwise judge only** (not the content-quality judge).
- Surface = **script + DB tables + a Judge Lab admin page** (interactive single-match re-judge stays in Match Viewer).
- Ground truth = **mu/Elo gap only** (replicate history); accuracy/implied-beta on large-gap pairs only.

## Phase 1: Eval engine + settings override
### Work Done
_(pending /research)_

## Phase 2: Structured logging + storage
### Work Done
_(pending)_

## Phase 3: Sweep runner + metrics
### Work Done
_(pending)_

## Phase 4: Ad-hoc match-viewer / prompt-modifier integration
### Work Done
_(pending)_
