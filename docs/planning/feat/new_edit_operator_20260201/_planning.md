# DebateAgent Implementation Plan

## Background
Adding a DebateAgent to the evolution pipeline, the last missing component from the AI Co-Scientist architecture. Runs structured 3-turn debate over top 2 Elo-ranked variants in COMPETITION phase only.

## Problem
The evolution pipeline lacks a debate/synthesis mechanism for combining the best aspects of competing variants. Currently variants evolve independently; debate enables cross-pollination.

## Phased Execution Plan
See the detailed plan provided by the user covering 4 phases: types, agent impl, pipeline integration, and tests.

## Testing
- debateAgent.test.ts with 12 test cases following reflectionAgent.test.ts patterns

## Documentation Updates
- None needed (internal pipeline component)
