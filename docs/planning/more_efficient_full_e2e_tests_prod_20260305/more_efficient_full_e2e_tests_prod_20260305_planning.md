# More Efficient Full E2E Tests Prod Plan

## Background
Split tests into evolution vs. non-evolution and run only the relevant portion based on what changed. Also detect and fix sources of flakiness in tests.

## Requirements (from GH Issue)
1. Split tests into evolution-focused vs. non-evolution, leveraging existing CI change-detection logic to run only relevant tests based on changed files
2. Enforce testing rules from `docs/docs_overall/testing_overview.md` to eliminate flakiness

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
- `docs/docs_overall/testing_overview.md` - May need updates to document evolution test splitting and CI changes
- `docs/feature_deep_dives/testing_setup.md` - May need updates to test statistics and CI workflow descriptions
