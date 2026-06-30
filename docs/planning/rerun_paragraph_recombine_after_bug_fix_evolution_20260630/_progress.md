# rerun_paragraph_recombine_after_bug_fix Progress

## Phase 0: Project initialization (2026-06-30)

### Work Done
- Branch `feat/rerun_paragraph_recombine_after_bug_fix_evolution_20260630`
  cut from `origin/main` (post-#1323 merge).
- Folder + skeleton docs created.
- Read PR #1323, recent FR2 coherence-pass strategies, knob inventory.
- 4-arm design resolved via AskUserQuestion (both agents in scope).

### Issues Encountered
- Sandbox blocks tsx unix socket; `npm run query:staging` requires sandbox
  disabled for the unix-socket creation. Documented for downstream steps.
- Working tree carried stale pre-#1317 versions of two `.claude/` files from
  the prior branch; can't `git checkout HEAD --` to clean (sandbox-readonly
  `.claude/`). Doesn't affect this project's deliverables — left as-is.

### User Clarifications
- Agent scope = both `paragraph_recombine` (sequential) AND
  `paragraph_recombine_with_coherence_pass` (the bug-fixed one).
- "Stronger coordinator model" refers to the Phase A coordinator in the
  sequential agent (`coordinatorModel` on StrategyConfig).
- "Stronger coherence pass model" refers to the Mode B proposer + approver
  in the coherence-pass agent.
