# Simplify Initialize Script Research

> **Note on project name:** the folder / branch name still contains `create_research_analysis_command` because it was chosen before that command was removed from scope. The name is kept for git-history continuity; only the research contents have been scoped down.

## Problem Statement
Simplify how `/initialize` works to reduce steps and make it more efficient. Always commit skeleton without asking. Assess context impact of auto-reading docs before reading them. The proposed `/create-analysis` command and `docs/research/` → `docs/analysis/` rename have been **removed from scope**.

## Requirements (2026-04-15)
- Always commit without asking.
- Help me assess context impact of always reading certain docs without asking.
- Remove GitHub issue creation entirely from `/initialize` (no `gh issue create`; no `#NNN` references in the templates).
- Collect project summary + detailed requirements via plain chat messages, NOT via the `AskUserQuestion` tool — user types freely in terminal.

## High Level Summary

`/initialize` is currently **524 lines** with ~18 numbered substeps and **~8 `AskUserQuestion` prompts**. Two rounds × 4 agents produced the following consensus:

**Target end state:** 9 numbered steps, **2 `AskUserQuestion` prompts + 3 plain-chat turns**, auto-commit, hardcoded `feat/` default branch, no GitHub issue creation. Estimated final size **~295 lines**.

**Context-cost gating:** add a lightweight `estimate_docs` helper (`wc -c / 4` ≈ tokens, no file reads) that prints a per-doc table (Lines, ~Tokens, %200k, Tier) and uses thresholds (5%/15%/40%) to auto-proceed / confirm / refuse.

**Per-branch-type fast paths:** `feat/` uses the full flow; `fix/` / `chore/` / `docs/` / `hotfix/` drop the auto-discovery agent, requirements prompt, and `_research.md` / `_progress.md` scaffolds (lazy-created by `/research` if the project grows in scope).

## Key Findings

### 1. Steps to cut (consensus GO across risk-review agent)
- **1.5 Branch type prompt** → default `feat`; regex-detect `^(fix|hotfix|chore|docs)_` to suggest matching prefix (guardrail for test-gate bypass correctness).
- **2.6 Manual doc tagging** → keep as a step but convert to plain-chat (not `AskUserQuestion`).
- **2.8 Final doc review** → redundant; silent dedup.
- **3 + 3.5 + 3.8** → merge (mkdir+status.json are pure writes; 3.8 Parts A/B → two plain-chat turns).
- **4 + 5 + 6** → merge into one "Create Project Documents" step (three Write calls back-to-back).
- **7 Commit prompt** → auto-commit (user-authorized).
- **8 GitHub issue creation** → removed entirely.

### 2. Steps that must stay (NO-GO from risk review)
- **2.1 Per-file carryover loop** → keep but regroup. MultiSelect-per-action risks destructive `git clean -fd` on wrong files. Mitigation: group by action (untracked-dir → gitignore, modified-tracked → commit) with batched confirm, preserving safety.
- **6.5 Doc mapping** → keep but make conditional. `.claude/doc-mapping.json` feeds `/finalize` across *future* branches; dropping risks permanent silent drift. Default to No, prompt only if project name signals new feature deep dive.
- **Auto-accept top 5 auto-discovered docs** → NO-GO. Explore ranks on keyword overlap of first 30 lines — false positives bloat `relevantDocs`, then bloat `/finalize` + `/plan-update`. Mitigation: auto-accept top **2**, pre-check 3-5 in multi-select (one-click accept, reviewable).

### 3. Context cost (from token-audit agent)
| Slice | Lines | ~Tokens | %200k |
|---|---|---|---|
| `initialize.md` itself | 524 | ~5.2k | 2.6% |
| Core trio (2.5) | 445 | ~4.5k | 2.2% |
| Typical deep dive | ~150 | ~1.5k | 0.75% |
| Worst-case dive (`testing_setup.md`) | ~670 | ~6.7k | 3.4% |
| All 26 deep dives | 5,191 | ~52k | **26%** |
| All 14 `evolution/docs/*.md` | 5,005 | ~50k | **25%** |

**Tiered policy:** T1 auto-read <5% combined; T2 confirm-with-preview 5–15%; T3 on-demand only >15%. Core trio stays auto; bulk deep-dive / evolution reads require explicit confirm.

### 4. Doc-cost estimator (concrete design)
- **Method:** `bytes / 4` via `wc -c` — no file reads, purely stat ops, ±15% accuracy.
- **Location:** `.claude/lib/estimate-docs.sh` (new `.claude/lib/` directory for shell helpers sourced from slash commands). NOT a Claude Skill-tool skill — this is deterministic shell, not LLM-guided procedure.
- **Insertion:** new step 2.45 (before mandatory core reads) and extend 2.7 step 3 (after auto-discovery).
- **UX:** single table (Doc, Lines, ~Tokens, %200k, Tier) then one `AskUserQuestion` multi-select with deselect-to-skip.
- **Thresholds:** auto <5%, confirm 5–15%, refuse >40% without override.

### 5. Plain-chat vs `AskUserQuestion`
- Feasibility: plain-chat pause works via explicit STOP directive — emit prose message, end turn with zero tool calls, wait for user's next turn.
- Fallback: `AskUserQuestion` with single `"Enter details"` option whose `Other` field accepts multi-line free text.
- Gate: flip to fallback if >1 of first 5 dogfood runs has `skipped_wait: true` in telemetry.
- Sanitization required: escape backticks, `$VAR`, leading `---` before writing user text to markdown.

### 6. Concrete edit plan for `initialize.md`
Final file ~295 lines (from 524). Renumber to 9 steps:
1. Parse & validate input (merge 1 + 1.5; hardcode `feat/` + regex override).
2. Create branch from remote main (keep).
3. Handle carryover files (grouped-by-action, not per-file).
4. Read core docs (cost-estimated first).
5. Manual doc tags (plain chat) + auto-discover + merge + confirm (single `AskUserQuestion` multi-select).
6. Create folder + `_status.json`.
7. Ask for summary (plain chat) + ask for requirements (plain chat).
8. Create 3 project docs (or subset per branch type) + auto-commit (no prompt).
9. Output summary (no `gh issue create`, no issue URL).

## Open Questions
1. Should the cost-estimator helper be extracted *in this project* or left as a follow-up? **Resolved:** included in Phase 3.
2. Is the **auto-commit** default safe in all carryover scenarios? Probably yes since commit is scoped to `docs/planning/<project>/`, but verify in integration tests.
3. Does keeping 6.5 (doc mapping) conditional fit the "fewer prompts" goal, or is the `/finalize` drift risk overstated for a typical branch?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/debugging_skill.md

### Evolution Docs (read per user request; 15 files, ~50k tokens — noted as cost lesson for this project)
- evolution/docs/README.md, architecture.md, data_model.md, entities.md, arena.md, cost_optimization.md, curriculum.md, logging.md, metrics.md, minicomputer_deployment.md, rating_and_comparison.md, reference.md, strategies_and_experiments.md, visualization.md, agents/overview.md

## Code Files Read
- `.claude/commands/initialize.md` (524 lines) — target of simplification
- `.claude/commands/research.md` (138 lines) — lazy-create consumer
- `.claude/commands/plan-review.md` (310 lines) — pattern reference
- `.claude/commands/finalize.md` (1149 lines) — downstream consumer of `relevantDocs` and project doc files
- `.claude/hooks/` listing — confirmed existing hooks
- `jest.config.js` / `jest.integration.config.js` — test harness for new unit tests
- `scripts/query-db.ts` — referenced during the now-removed `/create-analysis` design
