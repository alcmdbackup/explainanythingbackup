# Debugging Skill Command Proposal Progress

## Phase 1: Research
### Work Done
- Analyzed existing `superpowers:systematic-debugging` skill (4-phase methodology)
- Documented logging infrastructure (client → server → OTLP pipeline)
- Catalogued MCP tools: Sentry, Supabase, Honeycomb, Playwright
- Deep dive into tmux infrastructure (instance files, port allocation, idle timeout)
- Deep dive into request ID propagation (client generation, server extraction, AsyncLocalStorage)
- Created comprehensive research document

### Files Analyzed
- `docs/feature_deep_dives/request_tracing_observability.md`
- `docs/docs_overall/environments.md`
- `docs/docs_overall/testing_overview.md`
- `docs/planning/tmux_usage/*.sh` (ensure-server, start-dev-tmux, idle-watcher)
- `.claude/hooks/block-manual-server.sh`, `cleanup-tmux.sh`
- `src/lib/requestIdContext.ts`, `src/lib/serverReadRequestId.ts`
- `src/hooks/clientPassRequestId.ts`

### Key Findings
1. Request ID is universal correlation key across all systems
2. Environment detection via `/tmp/claude-instance-*.json`
3. All observability tools are configured but not unified
4. Gap: No project-specific debugging command exists

## Phase 2: Design
### Work Done
- Used brainstorming skill to iteratively design the skill
- Decided on append-only structure (keep systematic-debugging verbatim, add appendix)
- Designed environment detection logic
- Designed sub-command structure (/debug logs, /debug errors, etc.)
- Created design document

### Design Decisions
1. **Append-only extension**: Include entire systematic-debugging, add project-specific appendix
2. **Environment-aware**: Auto-detect local vs deployed
3. **Request ID correlation**: Universal key for cross-system tracing
4. **Sub-commands**: Quick access for experienced users

### Design Document
- `docs/plans/2026-01-16-debugging-skill-design.md`

## Phase 3: Implementation
### Work Done
- Created `.claude/skills/debug/SKILL.md` - Full skill with methodology + project tools
- Created `.claude/commands/debug.md` - Command that invokes the skill
- Updated `docs/feature_deep_dives/debugging_skill.md` - Documentation

### Files Created
| File | Purpose |
|------|---------|
| `.claude/skills/debug/SKILL.md` | Full debugging skill (systematic-debugging + project appendix) |
| `.claude/commands/debug.md` | User-invocable command |
| `docs/plans/2026-01-16-debugging-skill-design.md` | Design document |
| `docs/feature_deep_dives/debugging_skill.md` | Feature documentation |

## Phase 4: Testing
### Pending
- [ ] Test `/debug` command invocation
- [ ] Test local environment detection (with tmux instance)
- [ ] Test deployed environment detection (without instance file)
- [ ] Test sub-commands: `/debug logs`, `/debug errors`
- [ ] Verify Sentry MCP integration
- [ ] Verify Supabase MCP log access

## Summary

The debugging skill has been implemented following the append-only design:
1. **Part 1**: Complete systematic-debugging methodology (verbatim from superpowers)
2. **Part 2**: Project-specific appendix with:
   - Environment detection
   - Local development debugging (tmux, server.log)
   - Deployed environment debugging (Sentry, Supabase MCP)
   - Request ID correlation
   - MCP tools quick reference
   - Sub-commands

The skill enforces the Iron Law: **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST**
