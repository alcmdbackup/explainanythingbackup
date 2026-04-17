# Multi-Agent Plan Review Loop

Structured, iterative review of planning documents until consensus is reached.

## When to Use
Use this skill when reviewing planning documents in `/docs/planning/`. Triggers multi-agent review with voting until all reviewers rate readiness 5/5.

## Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    PLAN REVIEW LOOP                         │
├─────────────────────────────────────────────────────────────┤
│  1. Launch 3 reviewer agents in parallel                    │
│     - Security & Technical Correctness                      │
│     - Architecture & Integration                            │
│     - Testing & CI/CD                                       │
│                                                             │
│  2. Each agent reviews and provides:                        │
│     - Critical gaps (blockers)                              │
│     - Minor issues (non-blockers)                           │
│     - Readiness score (1-5)                                 │
│                                                             │
│  3. Aggregate results:                                      │
│     - If ANY score < 5: Apply fixes, go to step 1           │
│     - If ALL scores = 5: Approve and exit                   │
│     - Max 5 iterations (escape hatch)                       │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

When this skill is invoked:

### Step 1: Initialize Review State
Create a review state file to track iterations:

```bash
mkdir -p .claude/review-state
STATE_FILE=".claude/review-state/$(basename $PLAN_FILE .md).json"
echo '{"iteration": 0, "max_iterations": 5, "reviews": []}' > "$STATE_FILE"
```

### Step 2: Launch Parallel Review Agents

Launch exactly 3 Task agents with subagent_type="Plan" in a SINGLE message (parallel execution):

**Agent 1: Security & Technical**
```
You are reviewing: [PLAN_FILE]

Focus: Security & Technical Correctness
- Security concerns (secrets exposure, file permissions)
- Technical correctness (API compatibility, error handling)
- Edge cases (network failures, race conditions)

Output format (STRICT JSON):
{
  "perspective": "security_technical",
  "critical_gaps": ["gap1", "gap2"],
  "minor_issues": ["issue1"],
  "readiness_score": 1-5,
  "reasoning": "Why this score"
}
```

**Agent 2: Architecture & Integration**
```
You are reviewing: [PLAN_FILE]

Focus: Architecture & Integration
- Integration with existing codebase patterns
- Code organization and module structure
- Cross-component dependencies
- Fixture/test infrastructure alignment

Output format (STRICT JSON):
{
  "perspective": "architecture_integration",
  "critical_gaps": ["gap1", "gap2"],
  "minor_issues": ["issue1"],
  "readiness_score": 1-5,
  "reasoning": "Why this score"
}
```

**Agent 3: Testing & CI/CD**
```
You are reviewing: [PLAN_FILE]

Focus: Testing & CI/CD
- Test coverage and strategy
- CI workflow completeness
- Rollback plan
- Verification checklist

Output format (STRICT JSON):
{
  "perspective": "testing_cicd",
  "critical_gaps": ["gap1", "gap2"],
  "minor_issues": ["issue1"],
  "readiness_score": 1-5,
  "reasoning": "Why this score"
}
```

### Step 3: Aggregate Results

After all agents complete, aggregate their JSON outputs:

```typescript
interface ReviewResult {
  perspective: string;
  critical_gaps: string[];
  minor_issues: string[];
  readiness_score: number;
  reasoning: string;
}

interface AggregatedReview {
  iteration: number;
  reviews: ReviewResult[];
  all_critical_gaps: string[];
  lowest_score: number;
  consensus_reached: boolean;
}
```

### Step 4: Decision Logic

```
IF lowest_score === 5 AND all_critical_gaps.length === 0:
  → APPROVE: Exit loop, document is ready

ELIF iteration >= max_iterations:
  → ESCALATE: Ask user for manual decision

ELSE:
  → ITERATE:
    1. Present gaps to user
    2. Apply fixes to plan document
    3. Increment iteration counter
    4. Go to Step 2
```

### Step 5: Apply Fixes (if iterating)

When critical gaps exist:
1. Use TodoWrite to create a todo for each critical gap
2. Edit the planning document to address each gap
3. Mark todos as complete
4. Re-run review loop

## Review Scoring Guide

| Score | Meaning | Action |
|-------|---------|--------|
| 1 | Fundamentally broken | Major rewrite needed |
| 2 | Critical gaps | Multiple blockers to fix |
| 3 | Significant issues | Some blockers remain |
| 4 | Minor issues only | Polish needed, no blockers |
| 5 | Ready for execution | No changes needed |

## Usage

Invoke via:
```
/plan-review docs/planning/my_feature/planning.md
```

Or Claude will auto-invoke when you ask to review a planning document.

## State File Location

Review state is persisted at:
```
.claude/review-state/<plan-name>.json
```

This enables:
- Resuming interrupted reviews
- Tracking iteration history
- Audit trail of review feedback
