# New Safe-to-Close Command Plan

## Background
Two related chores: (1) create a new `/safe_to_close` slash command that aggregates close-readiness signals (open GH PRs across worktrees; unchecked plan items; missing/stale `/finalize` artifacts; un-promoted migrations; un-released backports; recent nightly red; open release-health issues; release PR in flight) and returns GREEN / YELLOW / RED — flagging items requiring user decision. Optionally appends a closing discussion to research/planning/progress docs. (2) Update `/initialize` so it unconditionally reads `environments.md`, `testing_overview.md`, `docs/feature_deep_dives/testing_setup.md`, and `docs/docs_overall/debugging.md` on every run, grouped as "Core Operations Docs" alongside the existing "Core Workflow Docs."

## Requirements (from GH Issue #1148)
Help me do two things

1. Create a new command called "safe_to_close" which does the following:
   - Verify no more open PRs on GH, across all worktrees
   - Verify no more outstanding items from plan or /finalize
     - Especially post deploy migrations or backports
   - Update research, planning, progress docs with all discussions
   - Give Green for good to close, or Red for open items
   - Flag what open items if any, if user needs to decide

2. Add so that for /initialize, it always reads environments.md, testing_overview.md, testing_setup.md, and @docs/docs_overall/debugging.md by default, without being asked

## Problem
Two related operational gaps:

**(a) The "is this work actually done?" question is implicit.** Open PRs in other worktrees get forgotten, plan checkboxes go un-ticked, `/finalize` artifacts get out of sync, and — most consequentially — migrations land on `main` and can sit un-promoted to `production` for weeks (the 62-day silent prod-schema drift documented in `environments.md`, PR #1073/#1074). R2D's forensics found at least 5 leading indicators beyond "un-promoted migration exists" (nightly red streaks, open release-health issues, stalled release PRs, release-frequency cliffs) that would each have caught the drift on day-1. A single command checking all of them on demand is cheaper than relying on attention to scattered alerts.

**(b) /initialize asks too often.** The current command reads 3 core docs unconditionally then asks the user to confirm common docs every run. Four of those (environments / testing_overview / testing_setup / debugging) are needed on every project regardless. Asking wastes attention and invites "Skip" answers that later cost rework.

## Options Considered

- [x] **Option A: Single command, single pass** — `/safe_to_close` runs all checks inline, prints one verdict block, exits. Simplest, matches `/finalize` style. Linear runtime (~30-60s for `gh pr list` + worktree scan + migration diff + nightly status). **Selected.** Adds a `--dry-run` flag (skip the optional doc-update mutation) and `--update-docs` flag (opt in to the doc-update step, default off — the verdict is the primary deliverable; appending is a bonus that users opt into deliberately).
- [ ] **Option B: Sub-commands** — `/safe_to_close prs`, `/safe_to_close migrations`, etc. for targeted checks. More flexible but adds surface area; the cross-signal verdict is the whole point. Rejected.
- [ ] **Option C: Read-only verdict + separate `/safe_to_close --update-docs` as a follow-on command** — split mutation from verdict. The user asked for both in one command; folded `--update-docs` as a flag instead. Rejected.

## Phased Execution Plan

### Phase 1: `/safe_to_close` command spec — file + frontmatter
- [ ] Create `.claude/commands/safe_to_close.md` with frontmatter:
  ```yaml
  ---
  description: Verdict + recommendations on whether the current branch / repo state is safe to close (no open PRs across worktrees, plan complete, finalize artifacts valid, no un-promoted migrations or release-health blockers).
  argument-hint: [--update-docs] [--dry-run]
  allowed-tools: Bash(git:*), Bash(gh:*), Bash(jq:*), Read, Edit, Write, Glob, Grep, AskUserQuestion
  ---
  ```
- [ ] No `.claude/settings.json` change required (commands are auto-discovered from `.claude/commands/*.md` per R1D §5)
- [ ] Argument parsing: `--update-docs` (opt-in mutation), `--dry-run` (print what would change, mutate nothing)

### Phase 2: Worktree + PR scan
- [ ] Enumerate worktrees: `git worktree list --porcelain` → parse `worktree`/`branch` pairs (R1A §1)
- [ ] Filter out placeholder slots: branch names matching `^refs/heads/git_worktree_37_[0-9]+$` are unused slots, skip silently
- [ ] **Defensive guard** (R2A #7): `git rev-parse --verify origin/production >/dev/null 2>&1 || YELLOW("origin/production not fetched")` before any check using it
- [ ] Single `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft,url,updatedAt` call (one query covers all worktrees)
- [ ] **Defensive guard** (R2A #10): wrap in `|| YELLOW("gh auth/network failed; PR state unknown")` — never crash
- [ ] For each worktree branch, classify against the open-PR list:
  - **Current worktree's branch, PR open, CI passing, approved** → YELLOW ("ready to merge — finalize complete")
  - **Current worktree's branch, PR open, CI failing or unapproved** → RED ("active work in flight on this worktree")
  - **Other worktree, PR open, `updatedAt` < 30 days** → RED ("active work in another worktree: $WORKTREE_PATH — PR #N")
  - **Other worktree, PR open, `updatedAt` ≥ 30 days** → YELLOW ("stale PR in $WORKTREE_PATH — PR #N — last activity $DAYS days ago")
  - **Branch with commits ahead of `origin/main`, no PR** → YELLOW ("unpushed commits on $WORKTREE_PATH/$BRANCH — was /finalize skipped?")
  - **Branch on `main` or `production`, or merged into either** → silently OK
- [ ] Draft PRs (`isDraft: true`) count under whichever bucket above applies (R1A §3)

### Phase 3: Plan + finalize-artifact scan (for current worktree)
- [ ] **Locate planning doc** via `_status.json` reverse-index, preferred over the three-path lookup (R1B §3):
  ```bash
  STATUS_FILES=$(grep -Frl "\"branch\": \"$BRANCH\"" docs/planning/*/_status.json 2>/dev/null)
  # If multiple matches (reused branch name — R2A #6): sort -V | tail -1 picks most-recent
  STATUS_FILE=$(echo "$STATUS_FILES" | sort -V | tail -1)
  ```
  - If zero matches → YELLOW ("no planning doc for branch $BRANCH — was /initialize run?"); skip checkbox scan
  - Fall back to three-path lookup only when `_status.json` reverse-index returns nothing
- [ ] **Code-fence-aware checkbox scan** (R1B §1 — verbatim from `/finalize` Step 1b.5):
  - Track open/close ``` fence state
  - Count `- [ ]` (unchecked) and `- [x]`/`- [X]` (checked) lines **outside** fences
  - **Template-placeholder filter** (R2A #9): exclude lines matching `^- \[ \] \[.*\]$` (literal-bracket placeholders left in from the initialize template)
  - If unchecked > 0 → RED with file:line list
- [ ] **Gate files** (R1B §2, schemas confirmed):
  - `.claude/push-gate.json` exists AND `.commit` matches `git rev-parse HEAD` → GREEN; otherwise RED
    - If push-gate exists but `.commit` differs from HEAD (R2A #11): RED, but **show the intervening commits inline** so the user can decide:
      ```bash
      git log "$(jq -r .commit .claude/push-gate.json)..HEAD" --oneline
      ```
    - If push-gate missing → RED ("`/finalize` not run on this branch")
  - `.claude/test-pass.json` exists AND `.commit` matches HEAD AND `.tests | length >= 6` → GREEN; otherwise YELLOW (test-pass.json is optional unlock for ci-gate=closed only)
  - `.claude/ci-gate.json` — explicit status → color map (R2A #5):
    - `"open"` → GREEN
    - `"pending"` → YELLOW ("CI still in progress")
    - `"closed"` → RED ("CI observed failing — see `gh pr checks`")
    - `"unknown"` / missing → YELLOW ("CI state not yet observed")

### Phase 4: Post-deploy migrations + backports
- [ ] **Pre-check** (R2A #7): `git fetch origin main production 2>/dev/null` — silent if offline, then verify both refs exist via `git rev-parse --verify`; YELLOW if either missing
- [ ] **Un-promoted migrations**: `git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql'`
  - Non-empty → RED with file list + age of each (via `git log -1 --format=%ai $FILE`)
  - **Known limitation** (R2A #3, documented inline in command): pure file-presence check, not schema-aware. False positive possible if a migration file was added then deleted; acceptable since false positives are safer than false negatives here.
- [ ] **Un-released commits**: `git log origin/main ^origin/production --oneline | wc -l`
  - Compute days since the OLDEST un-released commit: `git log origin/main ^origin/production --format=%at | tail -1`
  - 0 commits → GREEN
  - ≥ 1 commits, oldest ≤ 14 days → YELLOW ("$N commits awaiting release; oldest $DAYS days ago")
  - oldest > 17 days (observed cadence max from R2D §3) → RED ("release cadence stalled — consider /mainToProd")
- [ ] **Active release PR** (R2D §B): `gh pr list --base production --state open --limit 1 --json number,title,createdAt,statusCheckRollup`
  - None → GREEN
  - One exists, < 6h old → YELLOW ("release in flight — PR #N — your close may race with it")
  - One exists, ≥ 6h old → RED ("release PR stalled — check CI")
- [ ] **No reverse check needed** (R1C §5): hotfixes go through main, not direct to production

### Phase 5: Release-health signals (added per R2D forensics)
- [ ] **Nightly E2E status** (R2D §2):
  ```bash
  gh run list --workflow=e2e-nightly.yml --branch=main --limit=2 --json conclusion,createdAt
  ```
  - Latest = `success` → GREEN
  - Latest = `failure`/`cancelled`, prior = `success` → YELLOW ("nightly red, 1 night")
  - Latest 2 both `failure`/`cancelled` → RED ("nightly red ≥ 2 nights — see release-health issues")
- [ ] **Open release-health issues** (R2D §3):
  ```bash
  gh issue list --label release-health --state open --json number,title,createdAt
  ```
  - None → GREEN
  - Any open ≤ 12h old → YELLOW
  - Any open > 12h old → RED with link to oldest issue
- [ ] All three Phase 5 checks wrap in `|| YELLOW(...)` for gh failure (R2A #10)

### Phase 6: Verdict display + next-action hints
- [ ] **Verdict block** modeled on `/finalize` Step 0d (R1D §3):
  ```
  Safe to Close Verdict
  ──────────────────────────────────────
  Worktree PR state:        ✓ / ⚠ / ✗
  Current plan checkboxes:  ✓ / ✗  (N unchecked)
  /finalize artifacts:      ✓ / ⚠ / ✗
  Un-promoted migrations:   ✓ / ✗  (N files, oldest $DAYS days)
  Un-released commits:      ✓ / ⚠ / ✗  (N commits, oldest $DAYS days)
  Active release PR:        ✓ / ⚠ / ✗
  Nightly E2E:              ✓ / ⚠ / ✗
  Release-health issues:    ✓ / ⚠ / ✗
  ──────────────────────────────────────
  VERDICT: GREEN / YELLOW / RED
  ```
- [ ] **GREEN** = all ✓; **RED** = any ✗; **YELLOW** = any ⚠ with no ✗
- [ ] For every ✗ and ⚠, print a "Next action" hint (template from R2D §4):
  - Un-promoted migrations → `Run: /mainToProd`
  - Nightly red ≥ 2 → `Check: gh issue list --label release-health --state open` + link to debugging.md
  - Stalled release PR → `Check: gh pr checks <PR#>`
  - Push-gate stale → `Run: /finalize` (or accept the typo-only diff and re-finalize)
  - Plan checkboxes unchecked → list line numbers + suggest `/plan-update`
- [ ] **State file**: when RED or YELLOW, write `.claude/safe-to-close-verdict.json` (schema modeled on R1C §5's `.claude/nightly-red-override.json`):
  ```json
  {
    "schema_version": 1,
    "verdict": "red|yellow|green",
    "checked_at": "ISO timestamp",
    "checked_sha": "<HEAD SHA>",
    "checks": { "<check_name>": { "status": "ok|warn|fail", "detail": "..." }, ... }
  }
  ```
  This file is gitignored (per `.claude/` convention), not committed. Provides audit trail for repeated runs.

### Phase 7: Doc-update step (opt-in via `--update-docs`)
- [ ] Only runs if `--update-docs` flag passed AND `--dry-run` NOT passed
- [ ] **Three sources** for "all discussions" (R2B confirms transcript files are inaccessible to the harness):
  1. `git log origin/main..HEAD --format='%h %s%n%b' --no-merges` — what shipped
  2. Planning doc's existing "Review & Discussion" section — what was already captured
  3. **One** AskUserQuestion: "Any final notes to capture before closing? (deferred work, late decisions, surprises)" — interactive catch-all
- [ ] **Append targets**:
  - `_progress.md`: append a final phase "## Phase N+1: Closeout" with subsections Work Done / Issues Encountered / User Clarifications, derived from the three sources above
  - `_planning.md` "Review & Discussion": append `### Closeout Notes` block (mirrors the `/plan-review` iteration-append pattern from R2B §5.1)
  - `_research.md`: append `## Post-Execution Findings` ONLY if user provided any notes that contradict or extend the original research; otherwise skip
- [ ] All edits via Edit tool, preserving existing structure
- [ ] If `--dry-run`, print the diff that would be applied and skip the Edit calls

### Phase 8: `/initialize` default-doc update
- [ ] **Edit 1** — `.claude/commands/initialize.md` Step 2.5 (lines 139-147): split "Core Documentation" into two labeled groups (R2C §3):
  ```markdown
  **Core Workflow Docs:**
  1. Read docs/docs_overall/getting_started.md
  2. Read docs/docs_overall/architecture.md
  3. Read docs/docs_overall/project_workflow.md

  **Core Operations Docs:**
  4. Read docs/docs_overall/environments.md
  5. Read docs/docs_overall/testing_overview.md
  6. Read docs/feature_deep_dives/testing_setup.md  ← note path is feature_deep_dives, NOT docs_overall
  7. Read docs/docs_overall/debugging.md
  ```
- [ ] **Edit 2** — Step 2.7 exclusion list (line 195): grow "3 core docs" → "7 core docs" with all 7 names listed
- [ ] **Edit 3** — Step 3.5 add a note clarifying that the 7 pre-read core docs do NOT belong in `_status.json.relevantDocs` (per R2C §A — putting them there would flood `/finalize` Step 6 with phantom "consider updating debugging.md" prompts; the doc-mapping.json file-pattern matching already covers them when actually relevant)
- [ ] **Edit 4** — Step 4 research-doc template (lines 286-290): split "Core Docs" into the same two groups
- [ ] **Edit 5** — Step 9 output summary template: add a "Core docs read: 7" line before the "Relevant docs discovered" line
- [ ] **Conditional skip** — for `docs/*` branches, the Operations docs are usually unnecessary. Out of scope for this phase but document as a future enhancement.

### Phase 9: Self-validation (manual)
- [ ] Run `/safe_to_close` from this worktree (PR not yet created) — expect: RED on "no `.claude/push-gate.json`" + RED on "$N un-released commits" (all the recent main-vs-production work)
- [ ] After /finalize + PR creation, re-run — expect: YELLOW on "current worktree PR ready to merge" + same migration/release signals
- [ ] After PR merge + checkout to main, re-run — expect: whatever the global state is at that moment
- [ ] Plant a fake `supabase/migrations/9999_test.sql` on a local branch off main — verify migration-drift RED path fires
- [ ] After Phase 8, run `/initialize chore/test_init_check` in a scratch worktree — verify all 7 core docs read without prompting; verify `_status.json.relevantDocs` excludes them

## Testing

### Unit Tests
- [ ] N/A — slash commands are markdown specs (consistent with finalize/mainToProd/initialize having no unit tests; R1D §7)

### Integration Tests
- [ ] N/A — same reason

### E2E Tests
- [ ] N/A — same reason

### Manual Verification
- [ ] Phase 9 scenarios above
- [ ] Run from a worktree whose branch matches NO `_status.json` — verify YELLOW "no planning doc" path
- [ ] Run with `--dry-run --update-docs` — verify nothing mutates but the would-be diff prints
- [ ] Run with network offline (`gh` unreachable) — verify YELLOW fallbacks, no crash
- [ ] Run in a worktree on `main` directly — verify it does not RED on "no plan / no push-gate" (those checks should be skipped or recognized as a release-state worktree)

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes

### B) Automated Tests
- [ ] None. Manual scenario coverage above is the validation strategy, consistent with existing slash commands.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/project_workflow.md` — add a "Step 9: Verify safe-to-close" pointing at the new command
- [ ] `docs/docs_overall/getting_started.md` — add `safe_to_close.md` to any slash-commands index if one exists
- [ ] `docs/docs_overall/environments.md` — cross-reference the migration-drift + nightly-red checks from `/safe_to_close` in the Release Cadence section (and note that the documented 14-day cadence is stale — real cadence is 2-3 days, /safe_to_close uses observed-max 17 days as the RED threshold)
- [ ] `docs/docs_overall/testing_overview.md` — no updates expected
- [ ] `docs/feature_deep_dives/testing_setup.md` — no updates expected
- [ ] `docs/docs_overall/debugging.md` — add a one-liner under "Cross-System Correlation" or similar: `/safe_to_close` provides a single-pass health verdict
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — add a row to the "Quick reference" table for `.claude/safe-to-close-verdict.json`; note that `/safe_to_close` reads `push-gate.json`, `test-pass.json`, and `ci-gate.json` for its finalize-artifact check
- [ ] `docs/feature_deep_dives/maintenance_skills.md` — no updates expected (referenced for worktree-enumeration pattern, no API surface changes)
- [ ] `docs/feature_deep_dives/iterative_planning_agent.md` — no updates expected
- [ ] `docs/docs_overall/managing_claude_settings.md` — no updates expected (no settings.json change required per R1D §5)
- [ ] `docs/docs_overall/instructions_for_updating.md` — no updates expected

## Review & Discussion

### Round 1 + Round 2 Research (2026-05-31)

Eight Explore agents launched in two rounds of four. Round 1 mapped the surface (PR/worktree state, plan+finalize contract, migration/backport detection, slash-command conventions). Round 2 went adversarial and forensic (edge cases, doc-update mechanism, exact /initialize diff, postmortem mining of the 62-day drift incident). Key load-bearing decisions documented in "Synthesis of R1+R2" sent to the user, summarized here:

- **PR scan must age-stratify**, not flag every open PR as RED. 30-day cutoff for "active vs stale."
- **`_status.json` reverse-index** is the preferred way to find the planning doc, with sort-by-recency for reused branch names.
- **Template-placeholder checkboxes must be filtered** (`^- \[ \] \[.*\]$`) to avoid false-positive unchecked counts.
- **CI-gate status map** must be explicit (open=GREEN, pending=YELLOW, closed=RED, unknown=YELLOW).
- **Doc-update is opt-in via `--update-docs`** because transcripts are inaccessible and forcing the mutation by default surprises users.
- **/initialize: two groups (Workflow + Operations), 7 docs total**, pre-read core docs stay OUT of `_status.json.relevantDocs` to prevent `/finalize` Step 6 flooding.
- **Add 4 release-health signals** beyond un-promoted migrations: nightly status, open release-health issues, active release PR, release frequency. Calibrated to observed 2-3 day cadence (RED at 17 days, not the stale-doc 14 days).
- **No schema-aware migration diff** — file-presence check is sufficient; false positives are safer than false negatives.
- **Known limitations documented inline**: file-presence (not schema) migration check; transcript inaccessibility; reused-branch-name handling picks most-recent.

[Subsequent /plan-review iterations append here.]
