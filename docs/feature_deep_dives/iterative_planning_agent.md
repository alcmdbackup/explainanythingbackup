# Iterative Planning Agent

Multi-agent review system that iteratively critiques planning documents until consensus is reached.

## Overview

The `/plan-review` command launches 3 specialized review agents in parallel, each evaluating a planning document from a different perspective. The loop continues until all agents vote 5/5 readiness, or max iterations (5) is reached.

## Why Use This

| Problem | Solution |
|---------|----------|
| Ad-hoc reviews miss issues | Structured 3-perspective review |
| Single reviewer blind spots | Security, Architecture, Testing agents |
| "Looks good to me" syndrome | Enforced 1-5 scoring with criteria |
| Review fatigue | Automated iteration until consensus |
| Inconsistent feedback | JSON-structured output |

## Quick Start

```bash
# Review a planning document
/plan-review docs/planning/my_feature/planning.md
```

The agent will:
1. Launch 3 reviewers in parallel
2. Collect structured feedback with scores
3. If any score < 5: fix gaps and re-review
4. Repeat until all scores = 5 or max iterations reached

## The Three Perspectives

### 1. Security & Technical Correctness
- Secrets exposure risks
- File permissions and access control
- API compatibility and assumptions
- Error handling and edge cases
- Network failure scenarios
- Dependency version compatibility

### 2. Architecture & Integration
- Integration with existing codebase patterns
- Module and file organization
- Fixture and test infrastructure alignment
- Cross-component dependencies
- Consistency with project conventions
- Code reuse opportunities

### 3. Testing & CI/CD
- Test strategy completeness
- CI/CD workflow changes
- Environment variables and secrets in workflows
- Rollback plan existence
- Verification checklist adequacy
- Test coverage for edge cases

## Scoring System

| Score | Meaning | What Happens |
|-------|---------|--------------|
| 5 | Ready for execution | If all 3 agents score 5, loop exits |
| 4 | Minor polish only | Loop continues, minor fixes applied |
| 3 | Some blockers remain | Loop continues, fixes applied |
| 2 | Multiple critical gaps | Loop continues, major fixes applied |
| 1 | Fundamentally broken | Loop continues, significant rewrite |

**Consensus = All three agents score 5/5**

## Output Format

Each agent returns structured JSON:

```json
{
  "perspective": "security_technical",
  "critical_gaps": [
    "Cookie file stored in predictable location without permissions",
    "No retry logic for network failures"
  ],
  "minor_issues": [
    "Consider adding debug logging"
  ],
  "readiness_score": 3,
  "score_reasoning": "Two critical security issues must be addressed"
}
```

## State Persistence

Review state is saved at `.claude/review-state/<plan-name>.json`:

```json
{
  "plan_file": "docs/planning/feature_x/planning.md",
  "iteration": 2,
  "max_iterations": 5,
  "history": [
    {
      "iteration": 1,
      "timestamp": "2026-01-02T10:30:00Z",
      "scores": [3, 4, 2],
      "critical_gaps": ["gap1", "gap2", "gap3"],
      "outcome": "iterate"
    },
    {
      "iteration": 2,
      "timestamp": "2026-01-02T10:45:00Z",
      "scores": [5, 5, 5],
      "critical_gaps": [],
      "outcome": "approved"
    }
  ]
}
```

This enables:
- Resuming interrupted reviews
- Audit trail of all feedback
- Tracking improvement over iterations

## Example Session

```
$ /plan-review docs/planning/vercel_bypass/planning.md

🔍 Plan Review Loop - Iteration 1/5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reviewing: docs/planning/vercel_bypass/planning.md

Launching 3 review agents...
✓ Security & Technical: Complete
✓ Architecture & Integration: Complete
✓ Testing & CI/CD: Complete

┌─────────────────────────────┬───────┬───────────────┐
│ Perspective                 │ Score │ Critical Gaps │
├─────────────────────────────┼───────┼───────────────┤
│ Security & Technical        │ 3/5   │ 2             │
│ Architecture & Integration  │ 4/5   │ 1             │
│ Testing & CI/CD             │ 2/5   │ 3             │
└─────────────────────────────┴───────┴───────────────┘

🔄 Consensus NOT reached (lowest: 2/5)

Critical gaps to fix:
1. [Security] Cookie file stored in predictable location
2. [Security] No retry logic for priming request
3. [Architecture] chromium-unauth won't receive bypass cookie
4. [Testing] Missing Supabase env vars in workflow
5. [Testing] No rollback plan documented
6. [Testing] Unit test location unclear

Applying fixes to planning document...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Plan Review Loop - Iteration 2/5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Launching 3 review agents...
✓ Security & Technical: Complete
✓ Architecture & Integration: Complete
✓ Testing & CI/CD: Complete

┌─────────────────────────────┬───────┬───────────────┐
│ Perspective                 │ Score │ Critical Gaps │
├─────────────────────────────┼───────┼───────────────┤
│ Security & Technical        │ 5/5   │ 0             │
│ Architecture & Integration  │ 5/5   │ 0             │
│ Testing & CI/CD             │ 5/5   │ 0             │
└─────────────────────────────┴───────┴───────────────┘

✅ CONSENSUS REACHED after 2 iterations!

All reviewers voted 5/5. Plan is ready for execution.
```

## Configuration

### Files Created

| File | Purpose |
|------|---------|
| `.claude/commands/plan-review.md` | The slash command definition |
| `.claude/skills/plan-review-loop/SKILL.md` | Skill for auto-invocation |
| `.claude/scripts/track-review-agent.sh` | Hook script for tracking |
| `.claude/review-state/*.json` | Persisted review state |

### Hook Configuration

In `.claude/settings.json`:

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/scripts/track-review-agent.sh"
          }
        ]
      }
    ]
  }
}
```

## Customization

### Adding More Perspectives

Edit `.claude/commands/plan-review.md` to add a 4th agent:

```markdown
**Agent 4 prompt:**
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Performance & Scalability
...
```

### Changing Max Iterations

Edit the state initialization in the command:

```json
{
  "max_iterations": 10
}
```

### Custom Scoring Criteria

Modify the agent prompts to include project-specific criteria:

```
Evaluate against our project standards:
1. Must follow patterns in CLAUDE.md
2. Must include unit tests for all new functions
3. Must document rollback procedures
...
```

## Best Practices

1. **Write complete planning docs first** - The review is only as good as the input
2. **Don't skip sections** - Use the planning template to ensure all sections exist
3. **Trust the process** - Let it iterate; early drafts often need 2-3 cycles
4. **Review the fixes** - The agent applies fixes automatically; verify they're correct
5. **Check state file** - If interrupted, review history to understand progress

## Troubleshooting

### Agents return inconsistent JSON

The prompts enforce strict JSON output. If agents deviate, they may be including commentary. The orchestrator should parse the JSON block from their response.

### Loop never reaches consensus

After 5 iterations, the loop escalates to manual review. This usually means:
- The plan has fundamental issues
- Requirements are unclear
- Conflicting constraints exist

### State file is stale

Delete `.claude/review-state/<plan-name>.json` to start fresh.

## Related

- [How to Analyze Claude Chats](../claude_usage_analysis/how_to_analyze_claude_chats.md)
- [Project Instructions](../docs_overall/project_instructions.md)
- [Planning Templates](../templates/)
