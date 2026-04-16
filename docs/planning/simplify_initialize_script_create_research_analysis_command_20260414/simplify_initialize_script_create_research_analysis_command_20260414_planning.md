# Simplify Initialize Script Plan

> **Note on project name:** the folder / branch name still contains `create_research_analysis_command` because it was chosen before the command was removed from scope. The name is kept for git-history continuity; only the plan contents have been scoped down.

## Background
Simplify `/initialize` to reduce steps and prompts; surface context cost before auto-reading doc batches. The `/create-analysis` command and the `docs/research/` → `docs/analysis/` rename have been **removed from scope**.

## Requirements (2026-04-15)
- Always commit without asking.
- Help me assess context impact of always reading certain docs without asking.
- **Remove GitHub issue creation entirely from `/initialize`.** No `gh issue create` call, no `#NNN` reference in the generated docs.
- **Collect project summary + detailed requirements via plain chat messages**, NOT via the `AskUserQuestion` tool. The user must be able to type freely and multi-line in the terminal. The assistant emits a normal message like `"Please type a 3-5 sentence summary for this project:"`, waits for the user's next turn, then emits a second normal message `"Please type the detailed requirements / task list:"`, waits again, then syncs both verbatim into `_research.md` and `_planning.md`.
- **Collect manual doc tags via plain chat**, NOT via `AskUserQuestion`. Same pattern: assistant emits `"Optional: type any docs you want to track (comma-separated names or paths), or 'skip' to skip:"`, waits for the user's reply, fuzzy-matches, and merges results into the auto-discovery list.
- **`/plan-review` auto-push on consensus (new 2026-04-15):** when all reviewers vote 5/5 with no critical gaps, automatically `git push` the current branch (`-u origin HEAD`). Safeguard against minicomputer crashes / local-machine loss. Never push `main` / `master`; respect `block-push-on-failures.sh`; skip cleanly on dirty worktree or push failure without overturning the consensus verdict.

## Problem
Current `/initialize` (524 lines, ~18 substeps, ~8 prompts) adds friction to project kickoff and silently pulls in doc batches that can consume 25–50% of the context window. The forced `gh issue create` step adds GitHub round-trips that aren't always wanted — users prefer to describe the project via plain chat and sync straight into the project docs.

## Options Considered
- [ ] **Option A: Minimal patch** — only cut confirmed-safe prompts (branch type, 2.6, 2.8, 7 commit). Lowest risk, modest payoff.
- [ ] **Option B: Full simplification + estimator + branch-type fast paths** (recommended) — apply the round-2 edit plan (9 steps, 2 prompts, ~295 lines), add `estimate_docs` helper, add per-branch-type fast paths, add telemetry.
- [ ] **Option C: Full rewrite of `/initialize` + merge `/research`** — highest disruption, overlaps composable pattern the team already uses. Not recommended.

## Target end state for `/initialize`

| # | Step | Interaction |
|---|---|---|
| 1 | Parse input, validate, abort if folder exists | none |
| 2 | Branch off `origin/main`: default `feat/<name>`; regex-detect `fix_|hotfix_|chore_|docs_` prefix | none |
| 3 | Handle carryover files (group by suggested action, batched confirm) | `AskUserQuestion` only if carryover files exist |
| 4 | Estimate doc cost → print table → auto/confirm/refuse by tier → read core docs | confirm prompt only if over threshold |
| 5a | **Plain chat #1 — manual tagging** | user types freely (or `skip`) |
| 5b | Auto-discover via Explore agent; merge with manual list, dedup; auto-accept top 2; pre-check 3-5 in multi-select | `AskUserQuestion` (the one guaranteed one) |
| 6 | Create folder + `_status.json` | none |
| 7a | **Plain chat #2 — project summary** | user types freely |
| 7b | **Plain chat #3 — requirements** | user types freely |
| 8 | Write 3 project docs + auto-commit (no prompt) | none |
| 9 | Output summary (no `gh issue create`, no issue URL) | none |

**Target size:** 524 → ~295 lines.

## Phased Execution Plan

> **Phase ordering note:** Phase 3 (doc-cost estimator) is a soft dependency of Phase 1 Step 4 (cost-gated core-doc reads). Phase 1 ships with a `# TODO: cost-gate` placeholder; Phase 3 replaces it.

### Phase 1: Simplify `/initialize`
Follow the concrete edit plan (9 steps / 2 AskUserQuestion prompts / 3 plain-chat turns).
- [ ] Delete Step 1.5 "Ask for Branch Type"; hardcode `BRANCH_TYPE="feat"` with regex override for `fix_|hotfix_|chore_|docs_` prefixes.
- [ ] Keep Step 2 unchanged.
- [ ] Rewrite Step 2.1 to group carryover files by suggested action (untracked-dir → gitignore, modified-tracked → commit, staged → leave) and batch-confirm — not per-file loop.
- [ ] Keep Step 2.5 core docs read, but gate via new cost-estimator (Phase 3).
- [ ] Replace Step 2.6 "Manual Doc Tagging" with a **plain chat prompt** (NOT `AskUserQuestion`). Use the STOP directive pattern (see block below). Parse reply, fuzzy-match against `docs/docs_overall/`, `docs/feature_deep_dives/`, `evolution/docs/`. Skip if reply is empty or `skip`. Full path → direct; partial → glob; multiple matches → emit another plain-chat disambiguation message.
- [ ] Keep Step 2.7 "Auto-discover docs" — Explore agent returns ranked list. Merge with manual list from Step 2.6, dedup. Auto-accept top **2**; present docs 3-5 pre-checked in a single `AskUserQuestion` multi-select (the one remaining `AskUserQuestion`).
- [ ] Delete Step 2.8 "Final Doc Review"; silent dedup in Step 2.7's multi-select handling covers it.
- [ ] Merge Step 3 + 3.5 into a single "Create Folder + Status File" step.
- [ ] Replace Step 3.8 Parts A+B with **two plain chat prompts** (NOT `AskUserQuestion`). Emit summary prompt → wait for reply → emit requirements prompt → wait for reply → sync both verbatim into `_research.md` (Problem Statement + Requirements) and `_planning.md` (Background + Requirements).
- [ ] **Plain-chat STOP directive (embed verbatim in `.claude/commands/initialize.md` Steps 2.6, 3.8 Part A, and 3.8 Part B):**
  > **PLAIN-CHAT PROMPT — DO NOT use `AskUserQuestion`.** Emit the following message as your assistant reply, then **end the turn immediately with zero tool calls**. Do not call Read, Write, Bash, Glob, Grep, Task, or any other tool in the same turn. Do not continue to the next step. Wait for the user's next message, which will arrive as a new user turn. When it arrives, treat the entire message body as the free-text answer and store it as `<VAR>`. Only then proceed to the next step.
  >
  > **Message text per step:**
  > - Step 2.6: `"Optional: type any docs you want to track (comma-separated names or paths), or reply 'skip' to skip."`
  > - Step 3.8 Part A: `"Please type a 3-5 sentence summary describing what this project will accomplish."`
  > - Step 3.8 Part B: `"Please type the detailed requirements / task list (bullets, numbered lists, multi-line all fine)."`
- [ ] **Fallback if plain-chat pausing proves flaky (from feasibility review):** switch to `AskUserQuestion` with a single option `"Enter details"` whose description says "Select this and use the Other field to type freely." The `Other` free-text field accepts multi-line input. Ship plain-chat first; flip to fallback if **>1 of the first 5 dogfood runs skips the wait** (concrete measurable gate; feeds from Phase 4.5 telemetry).
- [ ] **Plain-chat sanitization (security gap):** before writing the user's free-text replies into `_research.md` / `_planning.md` via the Write tool, sanitize to prevent markdown/heredoc/shell issues:
  - Escape ``` ` ``` → `` \` ``, `$` in contexts where the block could be interpolated.
  - Detect and fence leading `---` (would be mistaken for frontmatter) by wrapping the whole user block inside a ```text fenced code block if it contains any `---` on its own line.
  - Do not shell-interpolate the captured string anywhere (no `echo "$SUMMARY"` → heredoc; use the Write tool directly).
  - Apply identical sanitization to the `AskUserQuestion` `Other` fallback path.
- [ ] Merge Steps 4, 5, 6 into one "Create Project Documents" step (three Write calls back-to-back) — must run AFTER the two free-text replies are received so `ISSUE_SUMMARY` and `ISSUE_REQUIREMENTS` can be inlined.
- [ ] Keep Step 6.5 "Documentation Mapping" **conditional**, default No (only prompt when project name signals new deep dive). Guards `/finalize` drift-detection per risk review NO-GO.
- [ ] Delete Step 7 commit prompt; unconditionally `git add docs/planning/<project>/ && git commit -m "chore: initialize <project>"`.
- [ ] **Delete Step 8 "Create GitHub Issue" entirely.** No `gh issue create` call, no issue URL capture, no issue-URL field in the Step 9 summary.
- [ ] Update Step 9 output summary: drop the "GitHub Issue:" line; drop any remaining references to deleted artifacts (branch-type variable, manually-tagged docs, doc-mapping additions).
- [ ] Sweep the research/planning template strings for `#NNN` and `GH Issue #NNN` placeholders — either remove them or rename to a generic "Project Description" heading.

### Phase 1.5: Shared scaffold helpers + downstream null-guards
Prep work so per-branch-type fast paths (Phase 2) don't break downstream consumers.

- [ ] **Proof-of-concept first (blocks the rest of this phase + Phase 3 + Phase 6):** write a 5-line test slash-command that `source`s (or `bash`-invokes) a trivial helper under `.claude/lib/` and verify: (a) cwd at exec time is repo root, (b) the relative path resolves, (c) function definitions survive across separate fenced bash blocks if `source` is used — OR confirm each block is a fresh shell and switch to `bash .claude/lib/<helper>.sh <args>` invocation. Record the proven pattern in `.claude/lib/README.md`.
- [ ] **Create new `.claude/lib/` directory** for shell helpers invoked from slash-command markdown bash blocks. Document the verified invocation pattern in `.claude/lib/README.md` (one paragraph).
- [ ] Create `.claude/lib/scaffold_research.sh` and `.claude/lib/scaffold_progress.sh`. Pure bash functions; given a project folder path + project name, write the template idempotently (no-op if file exists). Single source of truth — prevents drift between `/initialize` and lazy-create paths.
- [ ] Shebang `#!/usr/bin/env bash` (not `sh`) — the branch-type regex needs bash.
- [ ] **Lazy-create atomicity:** `[ -f "$FILE" ] || cat > "$FILE" <<'TEMPLATE'` (single-quoted delimiter prevents `$VAR` expansion in user-supplied content).
- [ ] **`/finalize` consumer audit:**
  - `.claude/commands/finalize.md:872-876` (Planning section of PR body) — null-guard for missing `_research.md` / `_progress.md`.
  - Grep `.claude/commands/finalize.md` for every occurrence of `_research`, `_progress`, `_planning`; confirm each either reads conditionally or treats missing-file as skip-not-fail.
  - Same audit for `.claude/commands/summarize-plan.md` and `.claude/commands/plan-update.md`.
- [ ] Add lazy-create calls to `/research` so invoking it on a `fix/` branch auto-scaffolds missing `_research.md` and `_progress.md`.

### Phase 2: Per-branch-type fast paths

Different branch prefixes carry different expected scope. `/initialize` detects the prefix in Step 1 (via regex on `PROJECT_NAME` or explicit `--type`) and applies one of five matrices below. Core doc reads (Step 4) stay enabled for every type since the 3-file core trio is only ~4.5k tokens (2.2% of a 200k window). Auto-commit is always on (no prompt) for every type.

**Step matrix:**

| Step | `feat/` (full) | `fix/` | `chore/` | `docs/` | `hotfix/` |
|---|---|---|---|---|---|
| 3 Carryover files | yes | yes | yes | yes | yes |
| 4 Core doc reads (always) | yes | yes | yes | yes | yes |
| 5a Manual doc tag chat | yes | yes | skip | yes | skip |
| 5b Auto-discover docs (Explore) | yes | skip | skip | skip | skip |
| 7a Summary chat | yes | yes | yes | yes | yes |
| 7b Requirements chat | yes | skip | skip | skip | skip |
| 8a `_research.md` | yes | lazy | skip | skip | skip |
| 8b `_planning.md` | yes | yes | yes | yes | yes (stub) |
| 8c `_progress.md` | yes | lazy | skip | skip | skip |
| 8d Auto-commit | yes | yes | yes | yes | yes |
| 9 Summary + next-step hint | yes | yes | yes | yes | yes |

"Lazy" = not created at init; `/research` creates it on first write if missing (scaffolded via Phase 1.5 helpers).

**Per-type step count:**
- `feat/`: 9 steps, 3 plain-chat turns, 1-3 `AskUserQuestion`
- `fix/`: 6 steps, 2 plain-chat turns, 0-1 `AskUserQuestion`
- `chore/` / `docs/`: 5 steps, 1-2 plain-chat turns, 0-1 `AskUserQuestion`
- `hotfix/`: 5 steps, 1 plain-chat turn, 0 `AskUserQuestion`

**Implementation tasks:**
- [ ] Type-detection regex in Step 1: `^(feat|fix|chore|docs|hotfix)_` against `PROJECT_NAME`; fallback to `feat` if no prefix.
- [ ] Thread `BRANCH_TYPE` through the script; conditional guards around Steps 5a, 5b, 7b, 8a, 8c.
- [ ] Next-step hints in Step 9 per type: `feat/` → `/plan-review`; `fix/` → `/debug` or `/research`; `chore/`/`docs/` → just implement; `hotfix/` → ship fast.
- [ ] Unit-test the regex with fixture names (`fix_typo`, `hotfix_auth_20260501`, `my_feature_20260501` → default feat; `fixup_typo` → feat; edge case `fix_;rm -rf_20260501` → regex extracts `fix` prefix only, suffix never `eval`'d).

### Phase 3: Doc-cost estimator
- [ ] **Location:** `.claude/lib/estimate-docs.sh` (pure bash library, invoked from slash commands via the pattern verified in Phase 1.5 PoC). NOT a Claude Skill-tool skill.
- [ ] Define `estimate_docs()` bash function; invoke from `.claude/commands/initialize.md` via the verified pattern (either `source .claude/lib/estimate-docs.sh && estimate_docs "$@"` if `source` works across blocks, or `bash .claude/lib/estimate-docs.sh "$@"` if each block is a fresh shell).
- [ ] Method: `bytes / 4` via `wc -c` — no file reads, ±15% accuracy.
- [ ] Insert call at Step 2.5 (before core-doc reads) and Step 2.7 step 3 (after auto-discovery).
- [ ] Print table: `Doc | Lines | ~Tokens | %200k | Tier`.
- [ ] Thresholds: auto <5% combined, confirm 5–15%, refuse >40% without explicit override.
- [ ] Tier classification: T1 core docs, T2 feature deep dives, T3 other.
- [ ] Unit-test the estimator math with fixed-byte fixture files.

### Phase 4: Telemetry + non-interactive fallback
- [ ] Instrument `/initialize` to append `{timestamp, branch_type, steps, prompts, tokens_read_estimate, duration_s, skipped_wait}` to `.claude/metrics/initialize.jsonl` on each run. Enables the 50×/year user to verify the speedup empirically and catch regressions. **No branch names, project paths, or user-entered text in the telemetry record** — aggregate counts only, to prevent leaking WIP feature intent.
- [ ] **Telemetry hygiene:** create `.claude/metrics/` directory with `mkdir -p .claude/metrics && chmod 700 .claude/metrics` (directory-level read restriction); create the JSONL with `chmod 600`; add `.claude/metrics/` to `.gitignore`. Document the schema in a dedicated `.claude/metrics/README.md` (not buried in `.claude/lib/README.md`). No rotation at low volume (~200 runs/year < 50KB), revisit if it exceeds 1MB.
- [ ] **Plain-chat gate metric:** `skipped_wait: bool` = true if the model emitted a tool call in the same turn as a plain-chat prompt. If >1 of the first 5 runs has `skipped_wait: true`, flip to `AskUserQuestion`+`Other` fallback.
- [ ] Optional `--interactive` flag (or auto-detect `$TERM` / non-TTY) that re-enables `AskUserQuestion` fallbacks for mobile / SSH-from-phone / scripted runs where free-form typing is awkward. Document in Step 9 output.

### Phase 5: Docs + memory
- [ ] Update `docs/docs_overall/project_workflow.md` if it describes `/initialize` steps that no longer match.
- [ ] Update `CLAUDE.md` if it mentions any removed step.
- [ ] Update existing memory entries that assume the old `/initialize` flow.

### Phase 6: `/plan-review` auto-push safeguard

**Motivation (2026-04-15 requirement):** after `/plan-review` reaches consensus (all reviewers 5/5, no critical gaps), automatically `git push` the current branch so the planning work survives a minicomputer crash or other local-machine loss.

**Repo reality checks (from architecture + testing review):**
- `.claude/hooks/block-push-on-failures.sh` **does NOT exist** in this repo (despite being referenced in `CLAUDE.md`). Phase 6 must not assume its presence — handle gracefully whether it exists or not.
- Consensus logic currently lives in **three** files, not two: `.claude/commands/plan-review.md`, `.claude/skills/plan-review/SKILL.md`, AND `.claude/skills/plan-review-loop/SKILL.md`. The two SKILL files are NOT identical copies (different subagent_type wiring).
- No precedent in the repo for slash-command markdown bash blocks `source`-ing files from `.claude/lib/` — needs a proof-of-concept before relying on it for Phase 3 and Phase 6.

**Scope (revised):** extract the auto-push logic to a single shell helper at `.claude/lib/auto_push_on_consensus.sh` — ONE point of truth. All three plan-review files (`commands/plan-review.md` + both `skills/plan-review*/SKILL.md`) call the helper via a single-line Bash invocation, not by duplicating bash blocks inline. This mirrors the "extract to `.claude/lib/`" pattern used for `estimate-docs.sh` and avoids three-way drift.

**Implementation tasks:**
- [ ] **Proof-of-concept for the `.claude/lib/` source pattern (must run first, blocks Phase 3 and Phase 6):** write a 5-line test slash-command that `source`s a tiny helper and verify (a) cwd at exec time is repo root, (b) `source` resolves the relative path, (c) function definitions survive across the bash blocks inside a single slash-command run. If fenced bash blocks each spawn a fresh shell, the pattern becomes "invoke via `bash .claude/lib/<helper>.sh <args>` instead of `source`". Document the verified pattern in `.claude/lib/README.md` and update Phase 3 + Phase 6 to match the proven invocation.
- [ ] Create `.claude/lib/auto_push_on_consensus.sh`:
  - Pure bash, shebang `#!/usr/bin/env bash`, `set -euo pipefail`.
  - Exits 0 for "pushed" or "skipped cleanly"; exits 1 only on internal error.
  - Emits all user-facing messages to stderr so the skill prompt can capture them.
  - Takes no arguments; reads current branch, remote, and `git status` internally.
- [ ] **Safety rails (in the helper):**
  - Refuse to auto-push if current branch is `main` or `master` → emit warning, exit 0.
  - Refuse if `git status --porcelain --untracked-files=no` is non-empty (unstaged tracked-file edits) → emit warning, exit 0. Note: allow untracked files, since they're unlikely to affect the branch state and commonly present (scratch notes, etc.).
  - **Stale-HEAD guard (from security review):** accept an optional `EXPECTED_HEAD` env var; if set and `git rev-parse HEAD` differs, skip push with a stale-HEAD warning. The plan-review skill captures HEAD at consensus time and passes it in.
  - Respect the `WORKFLOW_BYPASS=true` env var (skip auto-push entirely; user has opted out).
  - Use `git push -u origin HEAD` (creates remote branch on first push and sets upstream tracking — intentional).
- [ ] **Test-gate interaction:**
  - Before attempting push, check whether `.claude/hooks/block-push-on-failures.sh` exists AND is listed in `.claude/settings*.json` as a PreToolUse hook. If absent, skip the detection logic entirely (no hook to detect).
  - If present and the push fails, grep stderr for the hook's signature string; on match emit: `"Auto-push blocked by test-gate hook. Expected on feat/ branches before /finalize. Re-run /plan-review after /finalize, or set WORKFLOW_BYPASS=true."` — then exit 0 (consensus still stands).
  - Never auto-bypass the hook.
- [ ] **Non-blocking on verdict:** all helper exit paths (success, skip, hook-block, stale-HEAD, push-fail) return 0 so the plan-review consensus verdict is never overturned. Warnings go to stderr; the skill emits its consensus message before invoking the helper.
- [ ] **Wire the helper into all three plan-review files:**
  - `.claude/commands/plan-review.md` — add one-line Bash invocation after consensus message.
  - `.claude/skills/plan-review/SKILL.md` Step 4 (line 96 area) — same.
  - `.claude/skills/plan-review-loop/SKILL.md` Step 4 (if it has a consensus branch — audit first; the two skill files have different subagent_type wiring and may diverge here).
  - Update the example session in `plan-review/SKILL.md` lines 159-160 to show the auto-push step.

**Testing:**
- [ ] `src/__tests__/unit/skills/plan_review_autopush.test.ts` — jest wrapper that shells out to `.claude/lib/auto_push_on_consensus.sh` in a temp git repo, verifying:
  1. Consensus path pushes when on a non-protected branch with clean worktree.
  2. Refuses on `main` / `master`.
  3. Refuses on dirty tracked-file worktree (allows untracked).
  4. Stale-HEAD env var triggers skip.
  5. `WORKFLOW_BYPASS=true` skips the push.
  6. Missing `block-push-on-failures.sh` hook doesn't crash the helper.
  7. Simulated push failure (remote misconfigured) emits warning but exits 0.
- [ ] Manual verification: run `/plan-review` to consensus on a disposable branch; confirm `git push` executes. Confirm the skipped-on-main path works.

**Rollback:** revert the helper file + the three call-site edits. No infrastructure touched beyond the skill prompts and the new `.claude/lib/` helper.

## Testing

> **Test harness decision:** wire all new tests into the **existing jest harness** under `src/__tests__/unit/skills/*.test.ts` — picked up by `jest.config.js` testMatch (`**/*.test.ts`). Path slots under the existing `unit/` convention (`src/__tests__/unit/components/` already exists). Shell helpers (`.claude/lib/*.sh`) are tested via a thin jest wrapper that shells out. No new runner, no bats dependency. Coverage thresholds (branches 41/functions 35/lines 42/statements 42) apply globally — confirm on first run that the shell-wrapper tests don't nudge the floor.

### Unit Tests
- [ ] `src/__tests__/unit/skills/estimate_docs.test.ts` — spawns `.claude/lib/estimate-docs.sh` with fixture files of known byte counts, verifies the table, Tier classification, and threshold decisions. Exact `bytes / 4` math assertions (deterministic given fixed fixtures).
- [ ] `src/__tests__/unit/skills/branch_type_regex.test.ts` — table-driven test: `feat_foo` → `feat`; `fix_bug` → `fix`; `hotfix_auth` → `hotfix`; `chore_cleanup` → `chore`; `docs_update` → `docs`; `my_feature` (no prefix) → `feat` (default); `fixup_typo` → `feat`; `fixture_test` → `feat`; injection-like names → regex extracts prefix only.
- [ ] `src/__tests__/unit/skills/sanitize_user_text.test.ts` — verifies the plain-chat sanitizer handles backticks, `$VAR`, leading `---`, and mixed payloads without mangling legitimate markdown. Also tests the same sanitizer on the `AskUserQuestion`+`Other` fallback payload (identical code path required by Phase 1).
- [ ] `src/__tests__/unit/skills/telemetry_append.test.ts` — given a temp `.claude/metrics/` dir, verify the JSONL append is atomic, schema matches `{timestamp, branch_type, steps, prompts, tokens_read_estimate, duration_s, skipped_wait}`, chmod 600 on file and 700 on dir, and that no branch name / project path / user text leaks into the record.

### Integration Tests
- [ ] Dry-run `/initialize feat_foo_20260415` in a scratch worktree; verify 9 numbered steps emitted, ≤ 2 `AskUserQuestion` prompts, skeleton auto-committed, doc-cost table printed before core-doc reads.
- [ ] **Per-branch-type dry-runs** with concrete pass criteria: `/initialize fix_bar_20260415`, `/initialize chore_baz_20260415`, `/initialize docs_qux_20260415`, `/initialize hotfix_zap_20260415`. Each run must emit a structured `STEP_DONE:<step_number>` marker to stderr so the test can grep for the expected marker set per matrix row; each run must produce the expected doc files (check via `ls docs/planning/<name>/*.md` against the matrix). Without the structured markers this step is not mechanically checkable.

### E2E Tests
- [ ] None required — slash commands are harness-level, not app-level.

### Manual Verification
- [ ] Run the real `/initialize` once on a throwaway branch; confirm prompt count and clicks match expectations.
- [ ] Review `/finalize` against a branch where docs were auto-accepted at top-2 — confirm no spurious doc-update prompts. Expected observable: the Planning/Documentation section prompts only list the explicitly-confirmed docs.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI surface changes in this project.

### B) Automated Tests
- [ ] Run `npm test -- src/__tests__/unit/skills/` (the repo exposes `npm test`, not `npm run test:unit`) — covers all 5 new unit-test files (estimate_docs, branch_type_regex, sanitize_user_text, telemetry_append, plan_review_autopush).
- [ ] Run `npm run lint && npm run typecheck && npm run build` to catch any stale references.

## Documentation Updates
- [ ] `docs/feature_deep_dives/debugging_skill.md` — only if skill invocation patterns change.
- [ ] `docs/docs_overall/project_workflow.md` — update only if its description of `/initialize` steps becomes stale.
- [ ] `CLAUDE.md` — scan for any stale refs to removed `/initialize` steps.

## Rollback Plan

- **Scope of risk:** `/initialize` rewrite (524 → ~295 lines), new `.claude/lib/` directory, new tests, telemetry file.
- **Backup before PR merges:** the PR itself is the backup — `git revert <merge-sha>` restores the entire change atomically. In addition, keep a one-release tombstone copy of the old skill at `.claude/commands/initialize.md.bak` (remove after one successful release cycle).
- **Rollback procedure:**
  1. `git revert <merge-commit-sha>` on `main` — restores all commits of this project.
  2. If a teammate has an in-flight project created under the new flow that needs to work on the reverted code: they manually run `/initialize` from `.claude/commands/initialize.md.bak`.
  3. Telemetry (`.claude/metrics/initialize.jsonl`) survives revert (gitignored, per-dev) — no cleanup needed.
- **In-flight project tolerance:** because lazy-create is added to `/research`, any `fix/` project created pre-rollback with a full `_research.md` still works post-rollback. Any `feat/` project created pre-rollback has all three scaffold files. No data-loss path.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
