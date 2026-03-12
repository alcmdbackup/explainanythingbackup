# Rework Tournament And Calibration Agent Evolution Plan

## Background
Merge CalibrationRanker and Tournament into a single ranking agent that evaluates variants on arrival. The new agent uses a two-phase approach: quick triage to eliminate weak variants, then focused comparison among top-20% contenders. This simplifies the pipeline by removing the EXPANSION/COMPETITION ranking split.

## Requirements (from GH Issue #NNN)
1. Replace CalibrationRanker + Tournament with a single RankingAgent
2. Evaluate-on-arrival: compare each new variant until either (A) confirmed bad or (B) in top 20% with sigma < threshold
3. Eliminate variants confidently outside top 20% early (mu + 2σ < top-20% cutoff)
4. Only require sigma convergence for top-20% contenders
5. Remove EXPANSION/COMPETITION ranking split (single ranking strategy for both phases)
6. Update pipeline dispatch, supervisor, and agent framework
7. Update tests and documentation

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/rating_and_comparison.md` - Swiss pairing, calibration, tournament docs will need major rewrite
- `evolution/docs/evolution/architecture.md` - Pipeline phase descriptions, agent classification, data flow diagrams
- `evolution/docs/evolution/arena.md` - Arena integration with new ranking agent
