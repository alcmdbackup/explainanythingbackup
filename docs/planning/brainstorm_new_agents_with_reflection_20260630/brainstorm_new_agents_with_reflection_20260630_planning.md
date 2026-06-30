# Brainstorm New Agents With Reflection Plan

## Background
Come up with new agent types for the evolution pipeline that leverage reflection (a meta-cognitive pattern where an agent reviews its own or another agent's output and proposes improvements). Note how well reflection-style agents have performed in recent analyses. The deliverable is a slate of candidate new agent designs grounded in what the data already says about reflection's strengths and failure modes.

## Requirements (from GH Issue #NNN)
Same as summary — come up with new agent types that leverage reflection. Note how well reflection agents performed in recent analyses performed.

## Problem
The pipeline has one first-class reflection agent (`reflect_and_generate`) and a handful of reflection-adjacent agents (criteria-driven, proposer-approver, iterative editing, paragraph_recombine coherence pass). Recent analyses give a clear signal that *selection-style* reflection wins, while *free-form-edit* reflection is currently neutral-to-negative because of judge-resolution limits and proposer/Mode mismatches. We need a structured brainstorm that proposes new reflection agent variants, locates each on the win/lose map from the data, and proposes the cheapest experiment that would falsify each one.

## Options Considered
- [ ] **Option A: Tactic-aware reflect ensembles** — variants of `reflect_and_generate` that vote across N independent reflection calls, lens-diverse reflectors, or chain-of-thought-then-vote. Closest neighbor to the proven winner; lowest implementation risk.
- [ ] **Option B: Reflect-then-edit (not regenerate)** — reflection picks an edit *region* + *operation*, then a Mode B propose-then-approve cycle applies it. Combines reflect's "selection" strength with editing's locality.
- [ ] **Option C: Self-critique loops on the generator** — generator emits draft → critic LLM emits weaknesses → generator revises N times, with each round's critique scoped (clarity → grounding → structure). Targets the criteria-style 81% %var>seed without the brittle CriticMarkup parser.
- [ ] **Option D: Reflection-as-judge / debate** — use reflection as a *meta-judge* that adjudicates between two candidate variants with reasoning + per-rubric verdicts, then optionally proposes a synthesis variant. Hybridizes debate_and_generate + rubric judging.
- [ ] **Option E: Cross-variant reflection** — reflector reads the top-K pool variants + their per-rubric rubric_breakdown rows, identifies *which rubric dimension is still weakest across the whole pool*, and dispatches a targeted tactic at that gap.

## Phased Execution Plan

### Phase 1: Finish research + map the existing reflection surface
- [ ] Read the queued evolution docs (criteria_agents, editing_agents, multi_iteration_strategies, paragraph_recombine, metrics, cost_optimization, reference)
- [ ] Read the queued feature deep dives (judge_evaluation, iterative_planning_agent, style_fingerprint)
- [ ] Build a single comparison table: existing reflection-style agents × (input lens, what they propose, what they execute, cost stack, last-measured Elo signal)

### Phase 2: Brainstorm new agent designs
- [ ] For each of Options A-E, draft a 1-page design spec: lens, prompt sketch, dispatch shape, cost stack, marker tactic, attribution dimension, expected Elo regime, failure modes
- [ ] Add at least 3 more candidates from outside the listed options (e.g. retrieval-augmented reflection, persona-disagreement reflection, length-budget-aware reflection)
- [ ] Score each design on (a) marginal Elo expected, (b) cost vs reflect_and_generate, (c) judge-resolution risk, (d) implementation cost

### Phase 3: Recommend the next experiment
- [ ] Pick 1-2 designs to take to a controlled staging A/B
- [ ] Pre-register the experiment shape (arms, n/arm, MDE, judge model, paired-vs-independent, decision rule) using the same template as the 2026-06-28 elo-agent-comparison analysis
- [ ] Note explicitly what we are *not* testing yet and why (cost, judge resolution, dependency on Mode B)

## Testing

### Unit Tests
- [ ] No new unit tests in this project — the deliverable is a brainstorm document, not code.

### Integration Tests
- [ ] N/A — no code changes.

### E2E Tests
- [ ] N/A — no code changes.

### Manual Verification
- [ ] Cross-check every quoted Elo / P(best) / %var>seed number in the planning doc against the source analysis files in `docs/analysis/`.
- [ ] Confirm each proposed agent design is consistent with the `Agent.run()` invariants (I1-I4) in evolution/docs/agents/overview.md so it could actually be implemented later.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes.

### B) Automated Tests
- [ ] N/A — no code changes.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/agents/overview.md` — may grow a "Candidate future agents" appendix if the brainstorm produces a design that gets approved for prototyping.
- [ ] `evolution/docs/strategies_and_experiments.md` — may need a paragraph referencing the brainstorm doc as a forward-looking design surface.

## Review & Discussion
_This section will be populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
