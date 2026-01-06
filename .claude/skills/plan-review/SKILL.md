---
name: plan-review
description: >
  Structured iterative review of planning documents with multi-agent voting until consensus (5/5 readiness).
  Use when: reviewing planning docs, asking "is this plan ready?", validating before execution,
  or wanting Security/Architecture/Testing perspectives on a plan.
allowed-tools:
  - Read
  - Edit
  - Write
  - Task
  - TodoWrite
  - Bash
  - Glob
---

# Plan Review Skill

Multi-agent iterative review loop that validates planning documents from Security, Architecture, and Testing perspectives until all reviewers vote 5/5.

## When This Skill Triggers

- User asks to "review this plan" or "is this plan ready?"
- User mentions "validate the planning document"
- User references a `*_planning.md` file and asks for feedback
- User wants multi-perspective review before execution

## Quick Start

If you know the path, use the slash command directly:
```
/plan-review docs/planning/my-feature/planning.md
```

Otherwise, just ask: "Can you review the planning doc for the nightly E2E migration?"

## How It Works

### 1. Initialize Review State

Create state file at `.claude/review-state/<plan-name>.json`:
```json
{
  "plan_file": "<path>",
  "iteration": 0,
  "max_iterations": 5,
  "history": []
}
```

### 2. Launch 3 Review Agents (PARALLEL)

All 3 agents must be launched in a SINGLE message with 3 Task tool calls.

**Agent 1: Security & Technical Correctness**
- Secrets exposure, file permissions, injection risks
- API compatibility, correct assumptions
- Error handling, network failures, retries
- Dependencies and version compatibility

**Agent 2: Architecture & Integration**
- Integration with existing codebase patterns
- Module/file organization
- Fixture and test infrastructure alignment
- Cross-component dependencies

**Agent 3: Testing & CI/CD**
- Test strategy completeness
- CI/CD workflow changes
- Environment variables and secrets
- Rollback plan existence

Each agent returns structured JSON:
```json
{
  "perspective": "security_technical",
  "critical_gaps": ["List each critical issue that BLOCKS execution"],
  "minor_issues": ["List non-blocking improvements"],
  "readiness_score": 1-5,
  "score_reasoning": "Explain your score"
}
```

### 3. Aggregate and Display Results

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | X/5 | N gaps |
| Architecture & Integration | X/5 | N gaps |
| Testing & CI/CD | X/5 | N gaps |

### 4. Decision Logic

**IF all scores = 5 AND no critical gaps:**
```
✅ CONSENSUS REACHED - Plan is ready for execution!
```
→ EXIT loop

**ELIF iteration >= 5:**
```
⚠️ MAX ITERATIONS REACHED - Manual review needed
```
→ ASK user whether to proceed

**ELSE:**
```
🔄 ITERATION N/5 - Fixes Required
```
→ FIX each critical gap by editing the planning document
→ Re-run review (GO TO Step 2)

### 5. Fix Workflow (MANDATORY)

For EACH critical gap:
1. TodoWrite: Add todo for the gap (in_progress)
2. Edit: Modify the planning document to address the gap
3. TodoWrite: Mark todo completed
4. Show what was changed

DO NOT just report gaps and stop. You MUST fix them and re-review.

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 5 | Ready to execute, no blockers |
| 4 | Minor polish only, no blockers |
| 3 | Some blockers remain |
| 2 | Multiple critical gaps |
| 1 | Fundamentally broken |

## Example Session

```
🔍 Plan Review Loop - Iteration 1/5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reviewing: docs/planning/feature-x/planning.md

Launching 3 review agents...
✓ Security & Technical: 3/5
✓ Architecture & Integration: 4/5
✓ Testing & CI/CD: 2/5

🔄 Consensus NOT reached (lowest: 2/5)

Critical gaps to fix:
1. [Security] No retry logic for API calls
2. [Testing] Missing rollback plan
3. [Testing] No unit test location specified

Fixing gaps...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Plan Review Loop - Iteration 2/5
...

✅ CONSENSUS REACHED after 2 iterations!
All reviewers voted 5/5. Plan is ready for execution.
```

## Related

- Slash command: `/plan-review <path>` for direct invocation
- Project workflow: `docs/docs_overall/project_workflow.md`
