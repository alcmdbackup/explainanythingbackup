# Experiments Vs Strategies Refactor Evolution Plan

## Background
Consolidate experiments as a higher-level orchestration layer over strategies, simplifying the data model. Currently, the evolution pipeline has two overlapping concepts — "experiments" (factorial design testing of configuration factors) and "strategies" (pipeline configuration configs). This project will merge experiment variations into the strategy system, making each experiment variation a strategy, and unifying the data models so strategies are the single source of truth for pipeline configuration.

## Requirements (from GH Issue #559)
Experiment variations should essentially be strategies. Make sure to unify the data models.

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
- `evolution/docs/evolution/strategy_experiments.md` - Core doc for experiment system; will need major rewrite to reflect unified model
- `evolution/docs/evolution/data_model.md` - Data model primitives will change as experiment variations become strategies
- `evolution/docs/evolution/architecture.md` - Pipeline architecture references to experiment system
- `evolution/docs/evolution/cost_optimization.md` - Batch experiment and strategy analysis sections may need updates
