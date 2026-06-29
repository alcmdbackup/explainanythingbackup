# Multi-Agent Analysis Review Loop

Structured, iterative review of analysis artifacts (EAR.md from `/run_experiment_analysis`, or any analysis report from `/write_doc_for_completed_analysis` standalone) until consensus is reached. Mirrors `.claude/skills/plan-review-loop/SKILL.md` with experiment-aware perspectives and per-section scoring.

## When to Use

- Invoked by `/run_experiment_analysis` Step 8 with `--perspective-set=from-experiment-analysis`.
- Optionally invoked standalone by authors of observational / calibration / investigation analyses (via `--perspective-set=from-standalone`).
- User says "review this analysis", "validate the EAR", or "rigorously check the analysis report".

## Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                ANALYSIS REVIEW LOOP                         │
├─────────────────────────────────────────────────────────────┤
│  1. Launch 3 reviewer agents in parallel                    │
│     - from-experiment-analysis perspective set:             │
│         • Methodology                                       │
│         • Statistical Validity                              │
│         • Causal Evidence                                   │
│     - from-standalone perspective set:                      │
│         • Methodology                                       │
│         • Evidence Quality                                  │
│         • Caveat Completeness                               │
│                                                             │
│  2. Each agent scores 6 EAR sections separately (1-5):      │
│     PRAP-compliance, Balance, Significance, Decisiveness,   │
│     Causal Evidence, Caveats. Standalone mode: NA-allowed   │
│     for the 4 experiment-only sections.                     │
│                                                             │
│  3. Aggregate: 3 reviewers × 6 sections = 18 cells.         │
│     - If min(all_non-NA cells) === 5 AND no critical_gaps:  │
│         → APPROVE, exit loop                                │
│     - If iteration >= 5: ESCALATE to user                   │
│     - Else: ITERATE — apply fixes, re-run                   │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: Initialize Review State

State file lives at `.claude/review-state/analysis-review-<target-basename>.json` (gitignored):

```json
{
  "target": "docs/planning/<project>/EAR.md",
  "perspective_set": "from-experiment-analysis",
  "iteration": 0,
  "max_iterations": 5,
  "history": []
}
```

### Step 2: Launch Parallel Reviewer Agents

All 3 agents must be launched in a SINGLE message via 3 parallel `Task` tool calls with `subagent_type=Plan`. Each agent reads the target EAR.md + the project's `_planning.md` (for PRAP context) + the `_research.md` (for decision history).

Perspective dispatch by `--perspective-set`:

| Set | Reviewer A | Reviewer B | Reviewer C |
|---|---|---|---|
| `from-experiment-analysis` | Methodology | Statistical Validity | Causal Evidence |
| `from-standalone` | Methodology | Evidence Quality | Caveat Completeness |

### Step 3: Per-Section Scoring (18-Cell Grid)

Each of 3 reviewers scores each of 6 substantive EAR sections separately (Decision #12 — literal reading of "all components 5/5"). Mechanical sections (Header, Dataset, Queries & Results, Adversarial Review Log) are NOT scored.

For `from-standalone` mode, the 4 experiment-only sections (PRAP-compliance / Balance / Significance / Decisiveness) accept `"NA"` as a valid score — standalone analyses (e.g. observational distribution studies) often won't have them.

## Reviewer JSON Schema

Each reviewer agent MUST return strict JSON in this shape. The agent's final assistant text IS the return value — no markdown, no prose outside the JSON.

```jsonc
{
  "perspective": "methodology",              // matches the dispatched perspective
  "section_scores": {
    "prap_compliance": 1,                    // 1-5 or "NA" in standalone mode
    "balance": 1,                            // 1-5 or "NA" in standalone mode
    "significance": 1,                       // 1-5 or "NA" in standalone mode
    "decisiveness": 1,                       // 1-5 or "NA" in standalone mode
    "causal_evidence": 1,                    // 1-5 (always scored)
    "caveats": 1                             // 1-5 (always scored)
  },
  "critical_gaps": ["..."],                  // blockers; loop iterates until empty
  "minor_issues": ["..."],                   // non-blockers; logged in state file
  "overall_reasoning": "..."                 // 2-3 sentences summarizing the verdict
}
```

### Section scoring rubric

| Score | Meaning |
|---|---|
| 5 | Section is rigorous, complete, and defensible. No changes needed. |
| 4 | Minor polish only, no blockers. |
| 3 | Some blockers remain in this section. |
| 2 | Multiple critical gaps in this section. |
| 1 | Section is fundamentally broken / missing required content. |
| `NA` | (standalone mode only) Section does not apply to this analysis type. |

### Section definitions

- **`prap_compliance`** — does the analysis follow the Pre-Registered Analysis Plan exactly as written (no post-hoc threshold drift, outlier rule applied as stated)?
- **`balance`** — does the Balance Audit show per-arm parity at every funnel step? Are imbalances flagged + explained?
- **`significance`** — is the named statistical test the right one? Are confidence intervals reported? Is multiplicity addressed for multi-criterion experiments?
- **`decisiveness`** — does the Decisiveness Audit report per-arm decisive % @0.6 + full bucket distribution + position-bias rate? Is the data sufficient to draw conclusions?
- **`causal_evidence`** — does the analysis cite ≥2 concrete examples per claimed pattern? Are anecdotes properly framed as examples-of-investigated-patterns rather than standalone claims?
- **`caveats`** — does the analysis enumerate ≥3 sources of drift / uncertainty? Are confounders called out (judge prompt priming, parent-quality differences, cost-cap interference, OpenRouter wipeout risk)?

## Stop Condition

After all 3 reviewers complete, aggregate:

```ts
interface SectionScore {
  numeric: number | null;  // null for NA
}

// Stop condition:
const allScores = reviewers.flatMap(r => Object.values(r.section_scores))
  .filter(s => s !== 'NA') as number[];
const minScore = Math.min(...allScores);
const totalCriticalGaps = reviewers.reduce((sum, r) => sum + r.critical_gaps.length, 0);

if (minScore === 5 && totalCriticalGaps === 0) {
  // APPROVE — exit loop
} else if (iteration >= max_iterations) {
  // ESCALATE — ask user for manual decision
} else {
  // ITERATE — apply fixes, re-run
}
```

### Step 4: Iterate or Approve

**APPROVE path** (all non-NA section scores === 5 AND total critical_gaps === 0):
```
✅ CONSENSUS REACHED — Analysis is ready.
```

**ESCALATE path** (iteration >= 5):
```
⚠ MAX ITERATIONS REACHED — Manual review needed.
Surfacing remaining critical_gaps to user via AskUserQuestion:
  - apply remaining fixes manually
  - abort review (keep target as-is)
  - continue with known gaps (documented in EAR's ## Adversarial Review Log)
```

**ITERATE path** (gaps remain, under iteration cap):
1. Display all critical_gaps grouped by reviewer.
2. AskUserQuestion: **apply fixes** (skill edits target) / **abort loop** (keep current state) / **continue with known gaps** (record in log + exit).
3. On "apply fixes": for each gap, edit the target EAR.md to address it. Mark which sections changed.
4. Re-run Step 2 (new iteration).

### Step 5: Persist Audit Trail

After each iteration, append to state file's `history`:

```json
{
  "iteration": 2,
  "reviewers": [<full JSON from each agent>],
  "fixes_applied": ["..."],
  "min_score": 4,
  "critical_gaps_count": 1
}
```

When the loop terminates (approve / escalate / abort), append a final summary block to the target EAR.md's `## Adversarial Review Log` section so the audit trail survives even if the state file is gitignored.

## Usage

```
/analysis-review-loop --target=<path-to-EAR.md> --perspective-set={from-experiment-analysis|from-standalone}
```

Invoked transparently by `/run_experiment_analysis` Step 8; can also be invoked directly by users wrapping a standalone analysis.

## Related

- Parent skill: `/run_experiment_analysis` (Step 8 — the experiment-analysis case).
- Promotion skill: `/write_doc_for_completed_analysis` (Step 6 — bidirectional provenance to `docs/analysis/<name>/`).
- Sibling pattern: `.claude/skills/plan-review-loop/SKILL.md` (this skill mirrors its structure for plan documents).
- Project design: `docs/planning/experiment_analysis_skill_20260628/` (Decision #4 — locks this sub-skill's extraction).
