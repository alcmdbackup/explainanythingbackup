# DebateAgent Research

## Problem Statement
Add a structured debate mechanism to the evolution pipeline inspired by AI Co-Scientist (2502.18864).

## High Level Summary
The DebateAgent runs a 3-turn debate (Advocate A / Advocate B / Judge) over the top 2 Elo-ranked variants, then synthesizes an improved variant. It runs only in COMPETITION phase, gated by feature flag and budget cap.

## Documents Read
- src/lib/evolution/types.ts
- src/lib/evolution/core/state.ts
- src/lib/evolution/config.ts
- src/lib/evolution/core/featureFlags.ts
- src/lib/evolution/core/supervisor.ts
- src/lib/evolution/core/pipeline.ts
- src/lib/evolution/agents/base.ts
- src/lib/evolution/agents/reflectionAgent.ts
- src/lib/evolution/agents/formatRules.ts
- src/lib/evolution/agents/formatValidator.ts
- src/lib/evolution/index.ts

## Code Files Read
- reflectionAgent.test.ts (test pattern reference)
