# /plan-review - Multi-Agent Plan Review with Voting

Two-phase structured review of planning documents. **Phase A** surfaces major structural gaps first and pauses for the user. **Phase B** runs the iterative detailed review until all reviewers vote 5/5.

## Usage
```
/plan-review <path-to-planning-doc>
```

## Why two phases

Detail-level review is wasted effort if the high-level architecture is wrong. A 5/5 score on detailed completeness doesn't help if the plan's chosen approach is the wrong one. So the skill now:

1. Runs a **structural review first** — does the plan's architecture make sense? Are the chosen abstractions right? Is the scope sound? Are there missing major components or wrong integration points?
2. **Pauses and asks the user** to confirm whether the surfaced structural gaps reflect their concerns, or whether anything else needs addressing at the structural level.
3. Only after structural sign-off does it proceed to the **detailed iterative review** (the original 3-agent voting loop with auto-fixes).

If structural gaps need to be fixed, Phase B sees a much cleaner plan and can converge in fewer iterations.

## Execution Steps

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
  "phase": "structural",
  "structural_review": {
    "completed": false,
    "gaps_found": [],
    "user_confirmed": false
  },
  "iteration": 0,
  "max_iterations": 5,
  "history": []
}
```

If `structural_review.completed === true && structural_review.user_confirmed === true` from a prior invocation, skip directly to Step 4 (Phase B). The user has already signed off on structure; re-running just resumes the detailed loop.

### 2. Phase A — Structural Review (one pass)

Launch 3 review agents in PARALLEL via 3 Task tool calls in a single message. Each agent looks at the plan from its perspective but **focuses narrowly on STRUCTURAL gaps** — things that, if wrong, would invalidate large portions of the plan rather than minor issues that need polishing.

**What counts as structural** (give to each agent):
- The plan's chosen architecture / abstraction is wrong (e.g., should be N agents not 1; should be at layer N not layer N-1)
- Missing major component or capability the plan implicitly assumes exists
- Misallocated responsibility (component X should own this, not component Y)
- Wrong integration point (should plug into pipeline at stage A, not stage B)
- Scope mismatch (too much for project intent / too little to be useful / the wrong set of things)
- Missing prerequisite (plan depends on Phase X that doesn't exist or isn't tracked)
- Cross-cutting concern omitted (auth model, observability, error propagation, cost ceiling)
- Foundational assumption that's likely wrong (e.g., "users have data X" when they don't)

**What does NOT count as structural** (defer to Phase B):
- Specific file not listed in the changes
- Test count missing
- Missing rollback steps
- Hardcoded value should be config
- Naming inconsistency
- Specific Zod schema gap
- File:line references missing

**Agent 1 prompt (Phase A):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Security & Technical Soundness (perspective label: security_technical)
PHASE: STRUCTURAL ONLY — focus on big-picture architectural concerns. Defer detail-level
issues to a later detailed review pass.

Surface up to 5 STRUCTURAL gaps from this perspective. Examples:
- Trust boundary undefined or misplaced (which component runs with which privilege)
- Wrong threat model (the plan secures against the wrong adversary)
- Critical security primitive missing entirely (no auth model, no input validation layer)
- Foundational technical assumption wrong (e.g., "this DB supports X" when it doesn't)

DO NOT include detail-level issues like "this specific file needs a try/catch" or
"this test name is wrong". Those go in the detailed review later.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "security_technical",
  "structural_gaps": [
    {"description": "concise gap description", "why_structural": "why this is foundational, not detail-level"}
  ]
}
```

**Agent 2 prompt (Phase A):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Architecture & Integration (perspective label: architecture_integration)
PHASE: STRUCTURAL ONLY — focus on big-picture architectural concerns. Defer detail-level
issues to a later detailed review pass.

Surface up to 5 STRUCTURAL gaps from this perspective. Examples:
- The plan's chosen abstraction is wrong (e.g., one big component instead of N small ones)
- Wrong integration point in the existing system
- Cross-cutting concerns ignored (data flow, observability, error propagation)
- Pattern conflict with existing codebase conventions at the design level
- Missing major component or stage that the plan implicitly assumes
- Misallocated responsibility (X should own this, not Y)
- Plan invents a new pattern when an existing one would fit

DO NOT include detail-level issues like "this Zod schema needs a refine" or
"file path is wrong". Those go in the detailed review later.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "architecture_integration",
  "structural_gaps": [
    {"description": "concise gap description", "why_structural": "why this is foundational, not detail-level"}
  ]
}
```

**Agent 3 prompt (Phase A):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Testing & CI/CD Strategy (perspective label: testing_cicd)
PHASE: STRUCTURAL ONLY — focus on big-picture testing & deployment concerns. Defer
detail-level issues to a later detailed review pass.

Surface up to 5 STRUCTURAL gaps from this perspective. Examples:
- Test strategy is at the wrong level (e.g., all unit tests when integration is needed)
- Critical paths fundamentally untestable as designed
- Rollback model is missing or incoherent (e.g., feature flag + DB migration combination
  has no clean rollback)
- CI workflow assumes infrastructure that doesn't exist
- Deployment ordering issues (X must ship before Y, not noted)
- Observability is missing for the critical thing being shipped

DO NOT include detail-level issues like "this test count is too low" or
"this specific test file is missing". Those go in the detailed review later.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "testing_cicd",
  "structural_gaps": [
    {"description": "concise gap description", "why_structural": "why this is foundational, not detail-level"}
  ]
}
```

After all 3 agents complete:

1. **Aggregate `structural_gaps`** from all 3 agents → `all_structural_gaps`
2. **Display** to user:

```
🔍 Plan Review — Phase A: Structural Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reviewing: <PLAN_FILE>

Surfaced N structural gaps:

[security_technical]
  1. <description>
     ⮕ <why_structural>
  ...

[architecture_integration]
  1. <description>
     ⮕ <why_structural>
  ...

[testing_cicd]
  1. <description>
     ⮕ <why_structural>
  ...

(If no structural gaps from any perspective, say:
   "No structural gaps surfaced. Proceeding to detailed review.")
```

3. **Pause and ask user** via AskUserQuestion (always, even if zero structural gaps — this is the user's chance to add their own structural concerns):

   ```
   Question: "Phase A structural review complete. How would you like to proceed?"
   Options:
     - "Proceed to detailed review" — accepts the structural gaps as-is; we'll
       address them as part of the detailed iterative loop
     - "I have additional structural concerns to add" — user provides more gaps;
       we add them and surface for review/fix before proceeding
     - "Some surfaced gaps are out of scope; let me clarify" — user can drop or
       reframe specific gaps before proceeding
     - "Fix structural gaps now before detailed review" — apply fixes for the
       surfaced structural gaps, then re-run Phase A once before Phase B
   ```

4. **Handle the user's choice:**

   **a. Proceed:** mark `structural_review.user_confirmed = true`, append surfaced gaps to history, save state, GO TO Step 4 (Phase B). The structural gaps will be carried into the detailed review's first iteration's `critical_gaps`.

   **b. Additional concerns:** AskUserQuestion (free-form via "Other" option) to capture each new gap. Append to `all_structural_gaps`. RE-DISPLAY the consolidated list and re-ask the four-option question.

   **c. Out of scope:** AskUserQuestion to let the user pick which surfaced gaps to drop or reframe. Update `all_structural_gaps`. RE-DISPLAY and re-ask.

   **d. Fix structural now:** apply fixes for the surfaced structural gaps (using the same fix-and-record workflow as Phase B Step 4 below). Then RE-RUN Phase A once. If the second Phase A pass surfaces fresh structural gaps, present them and ask again. Cap at 2 Phase A passes before forcing transition to Phase B.

5. **Append a "Phase A Structural Review" subsection** to the planning doc's `## Review & Discussion` section (create if missing):

   ```markdown
   ### Phase A — Structural Review

   **Surfaced gaps:**
   - [perspective_label] description (why_structural)

   **User decision:** [proceed | additional_concerns | out_of_scope | fix_now]

   **Fixes applied (if user chose fix_now):**
   - [perspective_label] Gap: "description" → Fix: "what was changed"

   **Resolution:** Carried forward into detailed review as critical_gaps / Resolved before Phase B.
   ```

6. **Save state** with `phase: "detailed"`, `structural_review.completed = true`, `structural_review.user_confirmed = true`, `structural_review.gaps_found = all_structural_gaps`.

### 3. (Removed — replaced by Phase A above)

### 4. Phase B — Detailed Iterative Review

This is the original 3-agent voting loop, with one tweak: the iteration starts with structural gaps (if any) carried forward from Phase A as initial `critical_gaps` to address.

**Launch 3 review agents (PARALLEL)** — single message, 3 Task tool calls.

Each agent returns structured JSON with a `readiness_score` from 1-5.

**Agent 1 prompt (Phase B):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Security & Technical Correctness (perspective label: security_technical)

PHASE: DETAILED REVIEW. Structural gaps were addressed in Phase A; you are now looking
at detail-level completeness and correctness. Focus on:

1. Security (secrets exposure, file permissions, injection risks)
2. Technical accuracy (API compatibility, correct assumptions)
3. Error handling (network failures, edge cases, retries)
4. Dependencies (version compatibility, missing packages)
5. **Verification section**: Plan MUST have a ## Verification section with A) Playwright
   verification for UI changes, and/or B) automated tests with file paths. Flag as
   CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

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

**Agent 2 prompt (Phase B):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Architecture & Integration (perspective label: architecture_integration)

PHASE: DETAILED REVIEW. Structural gaps were addressed in Phase A; you are now looking
at detail-level integration correctness. Focus on:

1. Integration with existing codebase patterns at the file/module level
2. Module/file organization and naming
3. Fixture and test infrastructure alignment
4. Cross-component dependency declarations
5. Consistency with project conventions (linting, naming, structure)
6. **Verification section**: Plan MUST have a ## Verification section with A) Playwright
   verification for UI changes, and/or B) automated tests with file paths. Flag as
   CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "architecture_integration",
  "critical_gaps": [{"description": "issue text", "perspective": "architecture_integration"}],
  "minor_issues": [{"description": "issue text", "perspective": "architecture_integration"}],
  "readiness_score": <1-5>,
  "score_reasoning": "Explain your score"
}
```

**Agent 3 prompt (Phase B):**
```
Review the planning document at: $PLAN_FILE

YOUR PERSPECTIVE: Testing & CI/CD (perspective label: testing_cicd)

PHASE: DETAILED REVIEW. Structural gaps were addressed in Phase A; you are now looking
at detail-level test and CI/CD completeness. Focus on:

1. Test strategy completeness (unit / integration / E2E coverage of specific paths)
2. CI/CD workflow changes (specific file edits, env vars added)
3. Environment variables and secrets handling
4. Rollback plan existence and steps
5. Verification checklist adequacy
6. **Verification section**: Plan MUST have a ## Verification section with A) Playwright
   verification for UI changes, and/or B) automated tests with file paths. Flag as
   CRITICAL GAP if missing or empty. Do NOT score 5/5 without verification.

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "testing_cicd",
  "critical_gaps": [{"description": "issue text", "perspective": "testing_cicd"}],
  "minor_issues": [{"description": "issue text", "perspective": "testing_cicd"}],
  "readiness_score": <1-5>,
  "score_reasoning": "Explain your score"
}
```

### 5. Aggregate Phase B Results and Record Review Discussion

After all 3 Phase B agents complete, aggregate:

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

**Append to "Review & Discussion" section** in the planning doc (under the Phase A subsection if present; create section if missing; append new iteration if iterations exist — do NOT duplicate the heading):

```markdown
### Phase B — Detailed Review · Iteration N
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
[populated after step 6 fixes — see below]
```

### 6. Decision

**IF lowest_score === 5 AND critical_gaps.length === 0:**
```
✅ CONSENSUS REACHED - Plan is ready for execution!

All reviewers voted 5/5. The plan has been approved.
Iteration count: N
Structural review: completed in Phase A (see Review & Discussion section)
```
→ EXIT loop

**ELIF iteration >= max_iterations:**
```
⚠️ MAX ITERATIONS REACHED

After 5 detailed review cycles, consensus was not reached.
Lowest score: X/5
Remaining gaps: [list]

Please review manually and decide whether to proceed.
```
→ ASK user whether to proceed or continue fixing

**ELSE:**
```
🔄 Phase B Iteration N/5 - Fixes Required

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
8. **Re-run Phase B review** - GO TO Step 4 (launch 3 detailed-review agents again). Phase A is NOT re-run unless the user explicitly resets.

DO NOT just report gaps and stop. You MUST fix them and re-review.

### 7. Update State

After each iteration, update state file:

```json
{
  "plan_file": "<path>",
  "phase": "detailed",
  "structural_review": {
    "completed": true,
    "gaps_found": [
      {"perspective": "architecture_integration", "description": "...", "why_structural": "..."}
    ],
    "user_confirmed": true,
    "user_decision": "proceed"
  },
  "iteration": N,
  "max_iterations": 5,
  "history": [
    {
      "phase": "structural",
      "timestamp": "2026-05-01T...",
      "gaps": [...],
      "user_decision": "proceed"
    },
    {
      "phase": "detailed",
      "iteration": 1,
      "timestamp": "2026-05-01T...",
      "scores": {"security_technical": 3, "architecture_integration": 4, "testing_cicd": 2},
      "gaps": [
        {"perspective": "security_technical", "description": "...", "fix_description": "..."}
      ],
      "outcome": "iterate"
    },
    {
      "phase": "detailed",
      "iteration": 2,
      "timestamp": "2026-05-01T...",
      "scores": {"security_technical": 5, "architecture_integration": 5, "testing_cicd": 5},
      "gaps": [],
      "outcome": "approved"
    }
  ]
}
```

**Backward compatibility** — when reading existing state files, handle ALL variants:

- **No `phase` key** (pre-two-phase state file) → assume `phase: "detailed"` and `structural_review.completed: true` so old state files skip directly to the detailed loop
- **Scores as array** `[3, 4, 2]` → convert to object: position 0=security_technical, 1=architecture_integration, 2=testing_cicd
- **Scores as abbreviated object** `{"security": 3, "architecture": 2, "testing": 2}` → normalize keys: `security` → `security_technical`, `architecture` → `architecture_integration`, `testing` → `testing_cicd`
- **Missing `gaps` key** → create empty array. Preserve existing `critical_gaps` and `critical_gaps_fixed` fields as read-only references.
- **Normalize on first write**: convert old formats to new schema, preserve old fields alongside new ones for auditability.

## Example Output

```
🔍 Plan Review — Phase A: Structural Review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reviewing: docs/planning/bring_back_editing_agents_evolution_20260430/...planning.md

Launching 3 structural-review agents...
✓ Security & Technical: 1 structural gap
✓ Architecture & Integration: 2 structural gaps
✓ Testing & CI/CD: 0 structural gaps

Surfaced 3 structural gaps:

[security_technical]
  1. EVOLUTION_DRIFT_RECOVERY_ENABLED feature flag has no audit trail of when
     it's flipped — flipping it in production silently changes behavior
     ⮕ Affects every editing iteration; rollback observability is foundational

[architecture_integration]
  1. Editing agent dispatched as parallel invocations but MergeRatingsAgent
     receives matches from each — the merge contract for editing is unclear
     ⮕ The merge step is the rating-system boundary; ambiguity here means
        ratings could be incorrectly applied across runs

  2. Schema replacement in 1.8 vs DETAIL_VIEW_CONFIGS replacement in 4.3
     happen in different phases but both need to land atomically — split is
     a deployment risk
     ⮕ Consumers of the discriminated union would break if one ships without
        the other

How would you like to proceed?
1. Proceed to detailed review
2. I have additional structural concerns to add
3. Some surfaced gaps are out of scope; let me clarify
4. Fix structural gaps now before detailed review

[user selects 4]

Applying fixes...
✓ Added drift-recovery audit logging task to Phase 6 docs
✓ Documented merge contract for editing in Phase 2.A.3
✓ Bundled schema + DETAIL_VIEW_CONFIGS into Phase 1.8 (single deploy unit)

Re-running Phase A...
✓ All perspectives: 0 structural gaps

Proceeding to Phase B detailed review.

🔍 Plan Review — Phase B: Detailed Review · Iteration 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Launching 3 detailed-review agents...

┌─────────────────────────────┬───────┬───────────────┐
│ Perspective                 │ Score │ Critical Gaps │
├─────────────────────────────┼───────┼───────────────┤
│ Security & Technical        │ 4/5   │ 1             │
│ Architecture & Integration  │ 5/5   │ 0             │
│ Testing & CI/CD             │ 4/5   │ 1             │
└─────────────────────────────┴───────┴───────────────┘

🔄 Consensus NOT reached (lowest: 4/5)

Critical gaps to fix:
1. [security_technical] No documented behavior when EVOLUTION_DRIFT_RECOVERY_ENABLED
   is set to invalid value (e.g., 'maybe')
2. [testing_cicd] Phase 6 E2E spec doesn't cover the drift-recovery path

Fixing gaps and re-running detailed review...

🔍 Plan Review — Phase B: Detailed Review · Iteration 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ CONSENSUS REACHED after 2 detailed iterations + 1 structural pass!

All reviewers voted 5/5. Plan is ready for execution.
```
