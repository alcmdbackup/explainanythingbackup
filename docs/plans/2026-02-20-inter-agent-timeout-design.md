# Inter-Agent Timeout for Evolution Pipeline Continuation

## Problem

The evolution pipeline's timeout check fires only between iterations (pipeline.ts line 343), not between agents within an iteration. When an iteration starts late (e.g., t=700s of 800s), the ~13 agents run sequentially with no timeout check. Vercel hard-kills the process at 800s before `checkpointAndMarkContinuationPending` fires, leaving the run in an unrecoverable state.

## Design

Add an inter-agent timeout check inside the agent execution loop. When time runs out mid-iteration, save which agents remain and resume from that point on the next cron invocation.

### Changes

**1. pipeline.ts — Inter-agent timeout check (lines 405-432)**

Before each agent execution, check elapsed time against the safety margin. When timeout fires, store remaining agent names and break both the agent loop and the iteration loop. Pass `resumeAgentNames` to `checkpointAndMarkContinuationPending`.

On resume, if `options.resumeAgentNames` is set, use it as the agent list for the first iteration only, then clear it for subsequent iterations.

**2. persistence.ts — Extend checkpoint functions**

- `checkpointAndMarkContinuationPending`: Accept `lastAgent` (default `'iteration_complete'`) and optional `resumeAgentNames` array. Store `resumeAgentNames` in the JSONB snapshot.
- `loadCheckpointForResume`: Query for `last_agent IN ('iteration_complete', 'continuation_yield')` instead of just `'iteration_complete'`.
- `CheckpointResumeData`: Add `resumeAgentNames?: string[]`.

**3. SQL migration — Parameterize `checkpoint_and_continue` RPC**

Add `p_last_agent TEXT DEFAULT 'iteration_complete'` parameter. Replace hardcoded `'iteration_complete'` in the INSERT with the parameter. Backwards-compatible via default value.

**4. Cron route — Pass resumeAgentNames through**

Extract `resumeAgentNames` from checkpoint data and pass to `executeFullPipeline` via `FullPipelineOptions`.

### Data Flow

```
Normal:      iter_start → agent1 → agent2 → ... → agent13 → iteration_complete checkpoint
Mid-timeout: iter_start → agent1 → agent2 → TIMEOUT → continuation_yield checkpoint (stores [agent3..agent13])
Resume:      load checkpoint → run [agent3..agent13] → iter_complete → next iter → full agent list
```

### Files Modified

- `evolution/src/lib/core/pipeline.ts`
- `evolution/src/lib/core/persistence.ts`
- `src/app/api/cron/evolution-runner/route.ts`
- `supabase/migrations/YYYYMMDD_inter_agent_timeout.sql`
- Unit tests for pipeline and persistence
