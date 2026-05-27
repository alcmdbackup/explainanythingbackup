# /plan-review - Multi-Agent Plan Review with Voting

Structured iterative review of planning documents until all reviewers vote 5/5.

## Usage
```
/plan-review <path-to-planning-doc>
```

## Execution Steps

When invoked, you MUST follow this exact process:

### 1. Initialize State

```bash
mkdir -p .claude/review-state
PLAN_FILE="$ARGUMENTS"
PLAN_NAME=$(basename "$PLAN_FILE" .md)
STATE_FILE=".claude/review-state/${PLAN_NAME}.json"
```

Read or create state:
```json
{
  "plan_file": "<path>",
  "iteration": 0,
  "max_iterations": 5,
  "history": []
}
```

### 2. Launch 3 Review Agents (PARALLEL)

You MUST launch all 3 agents in a SINGLE message with 3 Task tool calls.

Each agent MUST return structured JSON with a readiness_score from 1-5.

**Agent 1 prompt:**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Security & Technical Correctness (perspective label: security_technical)

Evaluate:
1. Security (secrets exposure, file permissions, injection risks)
2. Technical accuracy (API compatibility, correct assumptions)
3. Error handling (network failures, edge cases, retries)
4. Dependencies (version compatibility, missing packages)
5. **Verification section**: Plan MUST have a ## Verification section with A) Playwright verification for UI changes, and/or B) automated tests with file paths. Flag as CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "security_technical",
  "critical_gaps": [{"description": "issue text", "perspective": "security_technical"}],
  "minor_issues": [{"description": "issue text", "perspective": "security_technical"}],
  "readiness_score": <1-5>,
  "score_reasoning": "Explain your score"
}

SCORING:
- 5 = Ready to execute, no blockers, verification section present
- 4 = Minor polish only, no blockers
- 3 = Some blockers remain
- 2 = Multiple critical gaps
- 1 = Fundamentally broken
```

**Agent 2 prompt:**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Architecture & Integration (perspective label: architecture_integration)

Evaluate:
1. Integration with existing codebase patterns
2. Module/file organization
3. Fixture and test infrastructure alignment
4. Cross-component dependencies
5. Consistency with project conventions
6. **Verification section**: Plan MUST have a ## Verification section with A) Playwright verification for UI changes, and/or B) automated tests with file paths. Flag as CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "architecture_integration",
  "critical_gaps": [{"description": "issue text", "perspective": "architecture_integration"}],
  "minor_issues": [{"description": "issue text", "perspective": "architecture_integration"}],
  "readiness_score": <1-5>,
  "score_reasoning": "Explain your score"
}
```

**Agent 3 prompt:**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Testing & CI/CD (perspective label: testing_cicd)

Evaluate:
1. Test strategy completeness
2. CI/CD workflow changes
3. Environment variables and secrets
4. Rollback plan existence
5. Verification checklist adequacy
6. **Verification section**: Plan MUST have a ## Verification section with A) Playwright verification for UI changes, and/or B) automated tests with file paths. Flag as CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "testing_cicd",
  "critical_gaps": [{"description": "issue text", "perspective": "testing_cicd"}],
  "minor_issues": [{"description": "issue text", "perspective": "testing_cicd"}],
  "readiness_score": <1-5>,
  "score_reasoning": "Explain your score"
}
```

### 3. Aggregate Results and Record Review Discussion

After all 3 agents complete, aggregate:

```
SCORES: {"security_technical": N, "architecture_integration": N, "testing_cicd": N}
LOWEST_SCORE: min(SCORES values)
ALL_CRITICAL_GAPS: agent1.critical_gaps + agent2.critical_gaps + agent3.critical_gaps
ALL_MINOR_ISSUES: agent1.minor_issues + agent2.minor_issues + agent3.minor_issues
```

Display summary table:

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | X/5 | N gaps |
| Architecture & Integration | X/5 | N gaps |
| Testing & CI/CD | X/5 | N gaps |

**Append to "Review & Discussion" section** in the planning doc (create section if missing, append new iteration if section exists — do NOT duplicate the heading):

```markdown
### Iteration N
**Scores**: Security & Technical: X/5, Architecture & Integration: X/5, Testing & CI/CD: X/5

**Critical Gaps**:
- [perspective_label] gap description

**Minor Issues**:
- [perspective_label] issue description

**Score Reasoning**:
- Security & Technical: [agent1.score_reasoning]
- Architecture & Integration: [agent2.score_reasoning]
- Testing & CI/CD: [agent3.score_reasoning]

**Fixes Applied**:
[populated after step 4 fixes — see below]
```

### 4. Decision

**IF lowest_score === 5 AND critical_gaps.length === 0:**
```
✅ CONSENSUS REACHED - Plan is ready for execution!

All reviewers voted 5/5. The plan has been approved.
Iteration count: N
```
→ EXIT loop

**ELIF iteration >= max_iterations:**
```
⚠️ MAX ITERATIONS REACHED

After 5 review cycles, consensus was not reached.
Lowest score: X/5
Remaining gaps: [list]

Please review manually and decide whether to proceed.
```
→ ASK user whether to proceed or continue fixing

**ELSE:**
```
🔄 ITERATION N/5 - Fixes Required

Lowest score: X/5
Critical gaps to address:
1. [gap from agent 1]
2. [gap from agent 2]
...

Applying fixes to the planning document...
```

**YOU MUST perform these actions (not optional):**

1. **Create todos** - Use TodoWrite to add one todo per critical gap
2. **Classify each gap** - Before fixing, classify as:
   - **Obvious**: Clear single fix (e.g., "missing rollback plan" → add rollback section)
   - **Ambiguous**: Multiple possible fixes or unclear intent (e.g., "auth approach unclear" → could be JWT, session, or OAuth)
3. **For ambiguous gaps** — use AskUserQuestion before fixing:
   - Question: "[perspective_label] gap: '[description]'. Multiple approaches possible:"
   - Options: [list 2-3 possible fixes]
   - Wait for user selection before proceeding
4. **Fix each gap** - For EACH critical gap:
   - Mark the todo as `in_progress`
   - Use the Edit tool to modify the planning document
   - Add the missing section, fix the incorrect assumption, or address the issue
   - Mark the todo as `completed`
5. **Record each fix** in the "Review & Discussion" section under the current iteration's "Fixes Applied":
   ```markdown
   - [perspective_label] Gap: "description" → Fix: "what was changed and why"
   ```
6. **Show diff summary** - After all fixes, summarize what was changed
7. **Increment iteration** - Update state file with new iteration count
8. **Re-run review** - GO TO Step 2 (launch 3 agents again)

**Example fix workflow:**
```
Gap: {"description": "No rollback plan documented", "perspective": "testing_cicd"}
Classification: Obvious (single clear fix)

1. TodoWrite: Add "Add rollback plan section" (in_progress)
2. Edit planning.md:
   - Add "## Rollback Plan" section
   - Document revert steps, mitigation, escalation
3. TodoWrite: Mark "Add rollback plan section" (completed)
4. Record in Review & Discussion:
   - [testing_cicd] Gap: "No rollback plan documented" → Fix: "Added ## Rollback Plan section with revert steps and escalation path"
```

DO NOT just report gaps and stop. You MUST fix them and re-review.

### 5. Update State

After each iteration, update state file using the new schema:

```json
{
  "plan_file": "<path>",
  "iteration": N,
  "max_iterations": 5,
  "history": [
    {
      "iteration": 1,
      "timestamp": "2026-01-02T...",
      "scores": {"security_technical": 3, "architecture_integration": 4, "testing_cicd": 2},
      "gaps": [
        {"perspective": "security_technical", "description": "...", "fix_description": "..."},
        {"perspective": "testing_cicd", "description": "...", "fix_description": "..."}
      ],
      "outcome": "iterate"
    },
    {
      "iteration": 2,
      "timestamp": "2026-01-02T...",
      "scores": {"security_technical": 5, "architecture_integration": 5, "testing_cicd": 5},
      "gaps": [],
      "outcome": "approved"
    }
  ]
}
```

**Backward compatibility** — when reading existing state files, handle ALL variants:

- **Scores as array** `[3, 4, 2]` → convert to object: position 0=security_technical, 1=architecture_integration, 2=testing_cicd
- **Scores as abbreviated object** `{"security": 3, "architecture": 2, "testing": 2}` → normalize keys: `security` → `security_technical`, `architecture` → `architecture_integration`, `testing` → `testing_cicd`
- **Missing `gaps` key** → create empty array. Preserve existing `critical_gaps` and `critical_gaps_fixed` fields as read-only references.
- **Normalize on first write**: convert old formats to new schema, preserve old fields alongside new ones for auditability.

## Example Output

```
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

Fixing gaps and re-running review...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Plan Review Loop - Iteration 2/5
...

✅ CONSENSUS REACHED after 2 iterations!

All reviewers voted 5/5. Plan is ready for execution.
```
