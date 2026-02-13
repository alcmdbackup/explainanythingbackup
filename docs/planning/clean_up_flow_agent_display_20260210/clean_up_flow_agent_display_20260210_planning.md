# Clean Up Flow Agent Display Plan

## Background
The flow critique agent appears in the evolution dashboard but lacks proper visual treatment. It renders with a default grey color in the Timeline tab (missing from AGENT_PALETTE) and shows confusing 0-variant/null-Elo rows in the ROI leaderboard since it's a critique-only agent that doesn't generate variants. Additionally, no agent documentation exists for the flow critique under docs/evolution/. This fix will clean up the dashboard display and add missing documentation.

## Requirements (from GH Issue #393)
1. Add flowCritique color to AGENT_PALETTE in TimelineTab.tsx
2. Fix ROI leaderboard showing confusing 0-variants/null-Elo for critique-only agents
3. Add flow critique agent documentation (no existing doc found under docs/evolution/)
4. Update visualization.md to document flow critique in Timeline agent table

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
- `docs/evolution/visualization.md` - Add flow critique to Timeline agent table and agent count
- `docs/evolution/rating_and_comparison.md` - May need note about flow critique's non-ranking nature
