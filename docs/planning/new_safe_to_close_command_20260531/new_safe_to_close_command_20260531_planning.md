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
  allowed-tools: Bash(git:*), Bash(gh:*), Bash(jq:*), Read, Edit, Write, AskUserQuestion
  ---
  ```
  (Note: `Glob` and `Grep` intentionally omitted — all directory traversal uses Bash `git`/`grep` shell invocations.)
- [ ] No `.claude/settings.json` change required (commands are auto-discovered from `.claude/commands/*.md` per R1D §5)
- [ ] **Add `.claude/safe-to-close-verdict.json` to `.gitignore`** as part of this phase. Verified via `grep .gitignore`: existing gate files are individually listed (`.claude/push-gate.json`, `.claude/ci-gate.json`, `.claude/test-pass.json`, `.claude/ci-gate.disabled`) — no wildcard. Append a single new line `.claude/safe-to-close-verdict.json` directly below the existing gate-file block (preserving alphabetical-by-introduction order is not required; co-locating with sibling files is).
- [ ] **Atomic commit**: stage both `.claude/commands/safe_to_close.md` AND `.gitignore` together in a single `chore: add /safe_to_close command` commit. Phase 1 is one logical change; partial commits would leave the gitignore-without-command or command-without-gitignore states.
- [ ] Argument parsing: `--update-docs` (opt-in mutation), `--dry-run` (print what would change, mutate nothing)
- [ ] **Pre-flight checks at the top of the command** (Phase 1.5 inside the markdown spec — runs on EVERY invocation regardless of `--update-docs`/`--dry-run` flags; fail YELLOW with explicit hint, do not crash). **Order matters: cheapest local check first, network calls last, auth gated before any network call.**
  - **Step 1.5a** (local, fail-fast): `[ -f .github/workflows/e2e-nightly.yml ]` (else YELLOW "Workflow file renamed — Phase 5 nightly check disabled")
  - **Step 1.5b** (local): `git rev-parse --verify origin/main >/dev/null 2>&1` AND `git rev-parse --verify origin/production >/dev/null 2>&1` (else YELLOW "Run: git fetch origin main production — Phase 4 will skip until refs are present"). Store the result in a shell variable `REFS_OK=1|0` consumed by Phase 4.
  - **Step 1.5c** (network, gates 1.5d): `gh auth status` succeeds (else YELLOW "Run: gh auth login — Phases 2/5/6 will skip"). Store as `GH_AUTH_OK=1|0`. If `GH_AUTH_OK=0`, skip 1.5d entirely (no point making network calls).
  - **Step 1.5d** (network, only if 1.5c passed): label existence via `gh label list --search release-health --json name --jq 'map(select(.name=="release-health")) | length > 0' 2>/dev/null` returning `true` (precise match, not substring). **Explicit error wrapper**: if `gh` exits non-zero (network failure, rate limit) OR jq returns anything other than `true` → YELLOW "Label `release-health` missing or unreachable — Phase 5 issue check will report unknown". Never crash.
  - Pre-flight failures do NOT abort the command — they produce a single "Pre-flight warnings" block ABOVE the verdict so the user knows which checks degraded. Each downstream phase that depends on a pre-flight check reads the stored variable and YELLOW-skips with "(Phase 1.5: $REASON)" appended.

### Phase 2: Worktree + PR scan
- [ ] Enumerate worktrees: `git worktree list --porcelain` → parse `worktree`/`branch` pairs (R1A §1)
- [ ] Filter out placeholder slots: branch names matching `^refs/heads/git_worktree_37_[0-9]+$` are unused slots, skip silently
- [ ] ~~Defensive guard for `origin/production`~~ — removed: Phase 1.5b already verifies both refs at the start of every run; Phase 2 only uses `origin/main` directly anyway. (Iter-3 review caught this as dead code.)
- [ ] Single `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft,url,updatedAt` call (one query covers all worktrees)
- [ ] **Defensive guard** (R2A #10): wrap in `|| YELLOW("gh auth/network failed; PR state unknown")` — never crash
- [ ] **All open PRs are surfaced — no age-based suppression.** User-feedback override of R2A #1: stale PRs are exactly the kind the user wants surfaced, since "old and forgotten" is the failure mode (cf. the 4 dormant PRs R1A found, including one from March 21). Classification rules:
  - **Current worktree's branch, PR open, CI passing AND approved** → YELLOW ("ready to merge — finalize complete; PR #N")
  - **Current worktree's branch, PR open, CI failing OR unapproved** → RED ("active work in flight on this worktree; PR #N")
  - **Other worktree, PR open (ANY age)** → RED with `$WORKTREE_PATH`, `PR #N`, age (`updatedAt`), draft flag if applicable
    - If `updatedAt > 30 days` → append annotation "STALE — last activity $DAYS days ago" so the user can decide to close abandoned PRs explicitly. Still RED, never YELLOW.
  - **Branch with commits ahead of `origin/main`, no PR** → YELLOW ("unpushed commits on $WORKTREE_PATH/$BRANCH — was /finalize skipped?")
  - **Branch on `main` or `production`, or merged into either** → silently OK
- [ ] Draft PRs (`isDraft: true`) count under whichever bucket above applies (R1A §3); annotate "(draft)" in the output so the user sees the distinction
- [ ] Output displays the **full list** of open PRs across all worktrees in a single table — none collapsed or omitted — so the user can do a complete walk-through before closing

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
- [ ] **Gate files** (R1B §2, schemas confirmed) — every JSON read includes `schema_version` validation with explicit three-state semantics:
  - **Field absent** → treat as v1 (omit-tolerant for gate files written by current `/finalize` which doesn't yet emit the field)
  - **Field present AND value == 1** → GREEN proceed
  - **Field present AND value ≠ 1** → YELLOW with "gate file `$FILE` has schema_version=$N (expected 1) — /safe_to_close may misread; consider upgrading the consumer". Do NOT silently accept v2+ as v1. (Future tools that intentionally omit the field to bypass this check is out of scope — that's an explicit-malice scenario.)
  - `.claude/push-gate.json` exists AND `.commit` matches `git rev-parse HEAD` → GREEN; otherwise RED
    - If push-gate exists but `.commit` differs from HEAD (R2A #11): RED, but **show the intervening commits inline** so the user can decide:
      ```bash
      git log "$(jq -r .commit .claude/push-gate.json)..HEAD" --oneline
      ```
    - If push-gate missing → RED ("`/finalize` not run on this branch")
  - `.claude/test-pass.json` exists AND `.commit` matches HEAD AND `.tests | length >= 6` AND `.schema_version == 1` (or missing) → GREEN; otherwise YELLOW (test-pass.json is optional unlock for ci-gate=closed only)
  - `.claude/ci-gate.json` — validate `.schema_version == 1` (or missing) first; then explicit status → color map (R2A #5):
    - `"open"` → GREEN
    - `"pending"` → YELLOW ("CI still in progress")
    - `"closed"` → RED ("CI observed failing — see `gh pr checks`")
    - `"unknown"` / missing → YELLOW ("CI state not yet observed")
  - **`jq` parse failure on any gate file** (corrupted JSON) → YELLOW with the offending file path printed; do NOT crash

### Phase 4: Post-deploy migrations + backports
- [ ] **Pre-check** (R2A #7): already gated by Phase 1.5 pre-flight — if either `origin/main` or `origin/production` failed to resolve there (`REFS_OK=0`), skip the entire Phase 4 with status `skipped`. The verdict row prints **`⊘ Phase 4 skipped — refs missing`** (not ⚠ YELLOW — `⊘` is the dedicated `skipped` symbol per the verdict schema; it's excluded from RED/YELLOW/GREEN aggregation). Inside Phase 4, do NOT re-fetch (avoid network surprise mid-run); rely on the Phase 1.5 fetch result.
- [ ] **Un-promoted migrations**: `git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql'`
  - Non-empty → RED with file list + age of each (via `git log -1 --format=%ai $FILE`)
  - **Known limitation** (R2A #3, documented inline in command): pure file-presence check, not schema-aware. False positive possible if a migration file was added then deleted; acceptable since false positives are safer than false negatives here.
- [ ] **Un-released commits**: `git log origin/main ^origin/production --oneline | wc -l`
  - Compute days since the OLDEST un-released commit: `git log origin/main ^origin/production --format=%at | tail -1`
  - 0 commits → GREEN
  - ≥ 1 commits, oldest ≤ 14 days → YELLOW ("$N commits awaiting release; oldest $DAYS days ago")
  - oldest > 17 days (observed cadence max from R2D §3) → RED ("release cadence stalled — consider /mainToProd")
- [ ] **Active PRs in flight** — symmetric across both bases (covers a gap surfaced in user review: original plan only checked production-targeting PRs, missing main-targeting in-flight work):
  - **Release PRs** (`gh pr list --base production --state open --json number,title,createdAt,statusCheckRollup`):
    - None → GREEN
    - One exists, < 6h old → YELLOW ("release in flight — PR #N — your close may race with it")
    - One exists, ≥ 6h old → RED ("release PR stalled — check CI")
  - **Main-targeting PRs** (`gh pr list --base main --state open --json number,title,author,createdAt,updatedAt,statusCheckRollup,headRefName`):
    - For each PR, compute CI status from `statusCheckRollup` and `updatedAt` age
    - Any PR with CI failing AND `updatedAt` > 24h → RED ("PR #N (@author): CI failing $DAYS days — release queue blocker")
    - Total open PR count > 20 → YELLOW ("$N PRs to main — queue backlog growing")
    - Otherwise → GREEN (count printed informationally; not flagged)
  - **Abandoned-worktree case** (my PRs without a matching worktree): cross-reference `gh pr list --author @me --base main --state open` against `git worktree list` branches. Any of MY open PRs to main whose `headRefName` doesn't appear in any worktree → RED ("PR #N — no worktree found; was the worktree deleted before merge?")
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
  Worktree PR state:        ✓ / ⚠ / ✗ / ⊘  (N open across worktrees — full list below)
  Current plan checkboxes:  ✓ / ✗ / ⊘  (N unchecked)
  /finalize artifacts:      ✓ / ⚠ / ✗ / ⊘
  Un-promoted migrations:   ✓ / ✗ / ⊘  (N files, oldest $DAYS days)
  Un-released commits:      ✓ / ⚠ / ✗ / ⊘  (N commits, oldest $DAYS days)
  Active PRs in flight:     ✓ / ⚠ / ✗ / ⊘  (release: N | main: N open, N stalled, N abandoned-worktree)
  Nightly E2E:              ✓ / ⚠ / ✗ / ⊘
  Release-health issues:    ✓ / ⚠ / ✗ / ⊘
  ──────────────────────────────────────
  VERDICT: GREEN / YELLOW / RED
  ```
- [ ] **GREEN** = all ✓; **RED** = any ✗; **YELLOW** = any ⚠ with no ✗
- [ ] For every ✗ and ⚠, print a "Next action" hint (template from R2D §4):
  - Un-promoted migrations → `Run: /mainToProd`
  - Nightly red ≥ 2 → `Check: gh issue list --label release-health --state open` + link to debugging.md
  - Stalled release PR → `Check: gh pr checks <PR#>`
  - Stalled main-targeting PR with failing CI → `Check: gh pr checks <PR#>` + `Notify: @author` (release queue blocker)
  - Abandoned-worktree PR → `Run: gh pr view <PR#>` then either re-create worktree (`git worktree add`) or close PR (`gh pr close <PR#>`)
  - Push-gate stale → `Run: /finalize` (or accept the typo-only diff and re-finalize)
  - Plan checkboxes unchecked → list line numbers + suggest `/plan-update`
- [ ] **State file**: when RED or YELLOW, write `.claude/safe-to-close-verdict.json` (schema modeled on R1C §5's `.claude/nightly-red-override.json`):
  ```json
  {
    "schema_version": 1,
    "verdict": "red|yellow|green",
    "checked_at": "ISO timestamp",
    "checked_sha": "<HEAD SHA>",
    "checks": { "<check_name>": { "status": "ok|warn|fail|skipped", "detail": "...", "skipped_reason": "..." }, ... }
  }
  ```
  - **`status` enum**: `ok` (✓ GREEN), `warn` (⚠ YELLOW), `fail` (✗ RED), `skipped` (⊘ — phase skipped due to Phase 1.5 pre-flight YELLOW, e.g. missing refs / gh auth / label). When `skipped`, `skipped_reason` field is required and references the Phase 1.5 sub-step (e.g. "1.5b: origin/production not fetched").
  - **Verdict display rendering**: `⊘ skipped` rows appear in the verdict table next to ✓/⚠/✗ but are excluded from the GREEN/YELLOW/RED aggregation logic (a skipped phase is informational, not blocking).
  - File is gitignored (per `.claude/` convention added in Phase 1), not committed. Provides audit trail for repeated runs.
  - Not re-entrant: concurrent invocations may clobber — bounded harm (audit-only file, no downstream consumer).

### Phase 7: Doc-update step (opt-in via `--update-docs`)
- [ ] Only runs if `--update-docs` flag passed AND `--dry-run` NOT passed
- [ ] **Pre-flight guards** (all produce YELLOW skip rather than crash):
  - **Detached HEAD**: `git symbolic-ref -q HEAD >/dev/null 2>&1 || YELLOW("Detached HEAD — skipping doc update")`
  - **No project folder found** (Phase 3 reverse-index returned zero matches): skip Phase 7 entirely with YELLOW ("No planning doc — nothing to update")
  - **Read-only docs**: for each of `_research.md`, `_planning.md`, `_progress.md`, check `[ -w "$file" ]` before editing; if not writable, YELLOW-skip that file with message ("$file is read-only — skipped"), continue with the rest
  - **Missing docs**: if any of the three target docs does not exist, YELLOW-skip with "$file missing" — do NOT create it (the user may have intentionally removed it)
- [ ] **Three sources** for "all discussions" (R2B confirms transcript files are inaccessible to the harness):
  1. `git log origin/main..HEAD --format='%h %s%n%b' --no-merges` — what shipped
  2. Planning doc's existing "Review & Discussion" section — what was already captured
  3. **One** AskUserQuestion: "Any final notes to capture before closing? (deferred work, late decisions, surprises)" — interactive catch-all
- [ ] **Markdown safety**: before applying each Edit, validate the **merged** (existing-file-content + new-block) result. "Unbalanced fences" is defined operationally as: `grep -c '^```' "$file_with_new_block_appended" % 2 != 0` (count of lines starting with ``` is odd). If unbalanced, YELLOW-skip that doc with "potential markdown corruption — skipped" and leave the file untouched.
- [ ] **Append targets**:
  - `_progress.md`: append a final phase "## Phase N+1: Closeout" with subsections Work Done / Issues Encountered / User Clarifications, derived from the three sources above
  - `_planning.md` "Review & Discussion": append `### Closeout Notes` block (mirrors the `/plan-review` iteration-append pattern from R2B §5.1)
  - `_research.md`: append `## Post-Execution Findings` ONLY if user provided any notes that contradict or extend the original research; otherwise skip
- [ ] All edits via Edit tool, preserving existing structure
- [ ] If `--dry-run`, print the diff that would be applied and skip the Edit calls

### Phase 8: `/initialize` default-doc update

**Anchor-text-based edits** (not line numbers) so future drift in initialize.md doesn't silently corrupt the file. Each edit must include a pre-flight `grep -F "<anchor>"` check that the exact text exists; if it doesn't, abort the entire Phase 8 with "initialize.md has drifted — manual review required" and surface to the user.

- [ ] **Pre-flight integrity check**: before any edit, verify all 5 anchor strings exist in `.claude/commands/initialize.md`. List of anchors below. If any missing → abort Phase 8 (do not partial-edit).

- [ ] **Edit 1** — Split Step 2.5 into Core Workflow + Core Operations groups (R2C §3).
  - **Anchor (find — full block, line 139 through line 147 in current initialize.md)**:
    ```
    ### 2.5. Read Core Documentation

    Before creating project files, read these three core documents to understand the codebase context:

    1. **Read** `docs/docs_overall/getting_started.md` - Documentation structure and reading order
    2. **Read** `docs/docs_overall/architecture.md` - System design, data flow, and tech stack
    3. **Read** `docs/docs_overall/project_workflow.md` - Complete workflow for projects

    These provide essential context for the project initialization.
    ```
  - **Replace with**: identical `### 2.5. Read Core Documentation` heading, then two labeled groups ("Core Workflow Docs:" with the 3 existing entries; "Core Operations Docs:" with the 4 new entries — environments, testing_overview, `docs/feature_deep_dives/testing_setup.md`, debugging), then the existing closing sentence "These provide essential context for the project initialization." (verbatim). Path-check: `testing_setup.md` lives under `feature_deep_dives`, not `docs_overall` (verified via Glob).

- [ ] **Edit 2** — Update Step 2.7's Explore-agent exclusion clause to list all 7 docs.
  - **Anchor (find)**: `Exclude the 3 core docs already read: getting_started.md, architecture.md, project_workflow.md`
  - **Replace with**: `Exclude the 7 core docs already read: getting_started.md, architecture.md, project_workflow.md, environments.md, testing_overview.md, testing_setup.md, debugging.md`
  - This is the load-bearing edit: it prevents the Explore agent from re-suggesting the new defaults, which keeps them out of AUTO_DOCS → out of `_status.json.relevantDocs` → prevents `/finalize` Step 6 flooding.

- [ ] **Edit 3** — Step 3.5 add a clarifying note under the `relevantDocs` field.
  - **Anchor (find)**: `- Populate from the user-confirmed list in step 2.7`
  - **Replace with**: `- Populate from the user-confirmed list in step 2.7\n- **Core docs are pre-read** (Step 2.5) and intentionally excluded from \`relevantDocs\` to avoid flooding \`/finalize\` Step 6 with phantom doc-update prompts; \`.claude/doc-mapping.json\` handles them via file-pattern matching when actually relevant`

- [ ] **Edit 4** — Step 4 research-doc template: split "Core Docs" into the same two groups.
  - **Anchor (find)**: `### Core Docs\n- docs/docs_overall/getting_started.md\n- docs/docs_overall/architecture.md\n- docs/docs_overall/project_workflow.md`
  - **Replace with**: two labeled subsections (`### Core Workflow Docs` + `### Core Operations Docs`) listing all 7 paths.

- [ ] **Edit 5** — Step 9 output summary template: add a "Core docs read: 7" line.
  - **Anchor (find)**: `Documents created:\n   - ${PROJECT_NAME}_research.md\n   - ${PROJECT_NAME}_planning.md\n   - ${PROJECT_NAME}_progress.md\nManually tagged docs:`
  - **Replace with**: the same block plus a new line `Core docs read: 7` inserted BEFORE the `Manually tagged docs:` line. (Position chosen so output reads chronologically: docs read → docs tagged → docs discovered.)

- [ ] **Conditional skip** — for `docs/*` branches, the Operations docs are usually unnecessary. Out of scope for this phase but document as a future enhancement.

### Phase 8b: Rollback plan

If Phase 8 edits produce a broken `initialize.md` (YAML breakage, accidental delete, wrong heading), the rollback strategy is `git checkout` (no committed state to worry about).

**Strict execution order — every step must pass before proceeding to the next:**

1. **Pre-flight integrity** (no file modifications yet):
   - For each of the 5 anchor strings in Edits 1-5, run `grep -F "<anchor>" .claude/commands/initialize.md`. ALL 5 must match.
   - If any anchor missing → abort Phase 8 entirely (no edits applied, no commit). Surface: "initialize.md has drifted — anchor for Edit N not found. Re-research current line numbers and update plan."

2. **Apply all 5 edits via Edit tool** (file is now modified but UNCOMMITTED):
   - If any Edit call errors (e.g. unique match failure) → immediately `git checkout HEAD -- .claude/commands/initialize.md` to discard ALL partial changes, then abort.

3. **Post-edit verification** (file modified, uncommitted; verify before staging):
   - For each of the 5 NEW anchor blocks (the `Replace with` content from Edits 1-5), grep for a distinctive substring (e.g. "Core Operations Docs" for Edit 1, "Exclude the 7 core docs" for Edit 2). ALL 5 must match.
   - Verify Step 2.5's labeled groups parse: `grep -c "^\*\*Core .* Docs:\*\*" .claude/commands/initialize.md` must return ≥ 2.
   - If any post-edit check fails → `git checkout HEAD -- .claude/commands/initialize.md` and abort.

4. **Stage and atomic commit** (only after all 5 post-edit checks pass):
   ```bash
   git add -- .claude/commands/initialize.md
   git commit -m "chore: /initialize defaults add 4 Core Operations Docs"
   ```
   No partial commits. No per-edit commits. One logical change → one commit.

5. **Post-commit smoke test (MANDATORY — not optional)** (no scratch-worktree required — runs in the current worktree):
   - Read `.claude/commands/initialize.md` once more and confirm it parses as valid markdown (no orphan ``` fences, no broken YAML frontmatter).
   - Invoke `/initialize chore/throwaway_smoke_$(date +%s)` interactively up to the point where Step 2.5 (Read Core Documentation) completes — i.e., confirm all 7 docs read successfully without error — then Ctrl-C BEFORE any AskUserQuestion fires. The goal is to confirm no parse-time error in the modified command spec AND that all 7 doc paths resolve. Failing here means revert via `git revert HEAD` on the atomic Phase 8 commit.

**Manual rollback (always available, any time after step 4):**
```bash
git revert HEAD                                       # if Phase 8 commit was bad
# OR for in-progress (uncommitted) state:
git checkout HEAD -- .claude/commands/initialize.md   # discard pending edits
```

### Phase 9: Self-validation (manual)

**Happy-path scenarios:**
- [ ] **HP-1**: Run `/safe_to_close` from this worktree (PR not yet created) — expect: RED on "no `.claude/push-gate.json`" + RED on "$N un-released commits"
- [ ] **HP-2**: After /finalize + PR creation, re-run — expect: YELLOW on "current worktree PR ready to merge" + same migration/release signals
- [ ] **HP-3**: After PR merge + checkout to main, re-run — expect: whatever the global state is at that moment
- [ ] **HP-4**: Run `/safe_to_close --dry-run --update-docs` — verify nothing mutates but the would-be diff prints
- [ ] **HP-5**: Plant a fake `supabase/migrations/9999_test.sql` on a local branch off main (create `supabase/migrations/` first if needed) — verify migration-drift RED path fires; clean up fake file after
- [ ] **HP-6**: Run `/finalize` to write push-gate.json, then make a typo-fix commit (so `.commit ≠ HEAD`) — verify Phase 3 prints RED with intervening commits inline (per Phase 3 line 92's "show intervening commits" rule)

**Threshold-boundary scenarios (load-bearing, called out in iter-3 review):**
- [ ] **TB-1**: Construct a state where un-released commits' oldest is 13 days, 15 days, 18 days — verify GREEN → YELLOW → RED transitions across the 14d/17d boundaries
- [ ] **TB-2**: Construct a state where nightly latest=`success`, then latest=`failure`/prior=`success`, then latest 2 both `failure` — verify GREEN → YELLOW → RED transitions
- [ ] **TB-3**: File a release-health label issue at T-0, run once (expect YELLOW); wait/spoof to >12h, re-run (expect RED) — verifies 12h boundary
- [ ] **TB-4**: Open a PR to production then wait/spoof age past 6h — verifies release PR 6h boundary YELLOW → RED

**Pre-flight / Phase 1.5 fallback scenarios:**
- [ ] **PF-1**: Temporarily `gh auth logout`, run `/safe_to_close` — expect: YELLOW pre-flight banner ("gh auth missing"); Phases 2/5/6 ⊘ skipped; Phases 3/4 still run
- [ ] **PF-2**: Run `/safe_to_close` in a fresh clone where `origin/production` was never fetched — expect: YELLOW ("origin/production not fetched"); Phase 4 ⊘ skipped
- [ ] **PF-3**: Rename `release-health` label temporarily (or run in a repo without the label) — expect: YELLOW pre-flight; Phase 5 issue check ⊘ skipped
- [ ] **PF-4**: Rename `e2e-nightly.yml` temporarily — expect: YELLOW pre-flight; Phase 5 nightly check ⊘ skipped

**Phase 3 / gate-file fallback scenarios:**
- [ ] **GF-1**: Hand-edit `.claude/push-gate.json` to add `"schema_version": 2` → expect: YELLOW with schema mismatch message
- [ ] **GF-2**: Hand-edit `.claude/ci-gate.json` to invalid JSON → expect: YELLOW "jq parse failure" with file path; no crash
- [ ] **GF-3**: Run with no `.claude/push-gate.json` (delete or skip /finalize) → expect: RED "/finalize not run"

**Phase 7 / doc-update fallback scenarios:**
- [ ] **DU-1**: `chmod -w _progress.md` then run `/safe_to_close --update-docs` → expect: YELLOW skip for that file; other 2 docs still updated
- [ ] **DU-2**: Run `/safe_to_close --update-docs` on a detached HEAD (`git checkout HEAD~1`) → expect: YELLOW "detached HEAD — skipping doc update"
- [ ] **DU-3**: Run `/safe_to_close --update-docs` from a branch with no matching `_status.json` → expect: YELLOW "no planning doc — nothing to update"

**Worktree scenarios:**
- [ ] **WT-1**: Run from a worktree on `main` directly — expect: Phase 3 checkbox/gate checks skip with "branch is main, no project" YELLOW; other phases run normally
- [ ] **WT-2**: Run with a peer worktree whose branch has an open PR > 30 days old — expect: RED row with "STALE — N days" annotation
- [ ] **WT-3**: Have an open PR (`gh pr list --author @me`) whose `headRefName` doesn't match any worktree — expect: RED with "abandoned-worktree" annotation + recovery hint (`gh pr close` or `git worktree add`)

**Phase 8 /initialize edit scenarios:**
- [ ] **IN-1**: After Phase 8, run `/initialize chore/throwaway_init_check_$(date +%s)` in this worktree — verify all 7 core docs read without prompting; verify `_status.json.relevantDocs` excludes them; manually delete the scratch project folder afterwards
- [ ] **IN-2**: Simulate anchor drift — temporarily edit `.claude/commands/initialize.md` to break the Step 2.7 anchor, run Phase 8 — expect: pre-flight integrity abort with "Edit 2 anchor not found"; revert the manual edit afterwards
- [ ] **IN-3**: After Phase 8 commit, verify `git revert HEAD` works cleanly (no conflicts), then `git revert HEAD` again to restore — confirms Phase 8b manual rollback works

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

- **All open PRs surfaced — no age suppression.** (User-feedback override of R2A's age-stratification suggestion: stale-and-forgotten is exactly the failure mode the user wants caught.) PRs > 30 days old are still RED but annotated "STALE — N days" so abandoned PRs surface and require explicit user decision to close.
- **`_status.json` reverse-index** is the preferred way to find the planning doc, with sort-by-recency for reused branch names.
- **Template-placeholder checkboxes must be filtered** (`^- \[ \] \[.*\]$`) to avoid false-positive unchecked counts.
- **CI-gate status map** must be explicit (open=GREEN, pending=YELLOW, closed=RED, unknown=YELLOW).
- **Doc-update is opt-in via `--update-docs`** because transcripts are inaccessible and forcing the mutation by default surprises users.
- **/initialize: two groups (Workflow + Operations), 7 docs total**, pre-read core docs stay OUT of `_status.json.relevantDocs` to prevent `/finalize` Step 6 flooding.
- **Add 4 release-health signals** beyond un-promoted migrations: nightly status, open release-health issues, active PRs in flight (symmetric across `--base main` AND `--base production`, including abandoned-worktree detection), release frequency. Calibrated to observed 2-3 day cadence (RED at 17 days, not the stale-doc 14 days).
- **No schema-aware migration diff** — file-presence check is sufficient; false positives are safer than false negatives.
- **Known limitations documented inline**: file-presence (not schema) migration check; transcript inaccessibility; reused-branch-name handling picks most-recent; not re-entrant (no file locking — concurrent invocations may clobber `.claude/safe-to-close-verdict.json`, but state file is read-only-for-audit so harm is bounded to losing one verdict's history).

### Iteration 1 plan-review fixes (2026-05-31)

Three reviewer agents (Security, Architecture, Testing) each scored 3/5. Critical gaps verified empirically before fixing — separated real blockers from false positives:

**Verified real (fixed):**
- `.claude/safe-to-close-verdict.json` not in `.gitignore` — added to Phase 1
- Brittle line-number edits in Phase 8 — replaced with anchor-text-based Edit calls + pre-flight integrity check
- Missing `origin/production` produced silent fallthrough — consolidated into Phase 1.5 pre-flight; Phase 4 skipped with YELLOW if refs missing
- Phase 7 doc-update had undefined fallbacks — added guards for detached HEAD, missing/read-only docs, unbalanced fences
- Gate JSON schemas could drift — added `schema_version: 1` (omit-tolerant) check on push-gate/test-pass/ci-gate reads with YELLOW fallback
- No rollback plan if Phase 8 corrupts initialize.md — added Phase 8b with atomic-commit + `git checkout` rollback
- No pre-flight check on `gh auth`, `release-health` label, `e2e-nightly.yml` workflow — added unified Phase 1.5 pre-flight block

**Verified false-positive (no change):**
- `e2e-nightly.yml` is the correct filename (confirmed via `ls .github/workflows/`)
- `release-health` label exists (confirmed via `gh label list --search release-health`)
- `git log ... | tail -1` gives the OLDEST commit — correct direction for "oldest-unreleased age" check
- Phase 8 Edit 2/4 already update exclusion list and research template (one agent missed these were already present)

**Acknowledged but deferred:**
- Automated tests for slash-command behavior — none exist for any other command; out of scope for this chore. Documented as a future cross-command initiative.
- Concurrent invocation file-locking — risk bounded (verdict file is audit-only); documented as known limitation.

### Iteration 2 plan-review fixes (2026-05-31)

Scores: Security 2/5 (regressed — found 7 issues introduced by iter 1 fixes), Architecture 4/5 (only gitignore implementation pending), Testing 3/5 (validation coverage gaps).

**Real critical gaps fixed (8):**
- Phase 1: atomic commit strategy (gitignore + safe_to_close.md together) made explicit
- Phase 1.5: pre-flight ordering corrected (local checks first, gh auth gates network calls); precise `jq` match for label; explicit "runs every invocation"
- Phase 3: schema_version semantics explicit three-state (absent=v1, ==1=ok, ≠1=YELLOW; no silent forward acceptance)
- Phase 7: "unbalanced fences" defined operationally (odd count of ``` lines); check applied to merged result not just new block
- Phase 8 Edit 1: anchor expanded to full 9-line block (heading through closing sentence)
- Phase 8b: strict 5-step execution order (pre-flight integrity → apply → post-edit verify → atomic commit → optional smoke test); scratch-worktree requirement dropped
- Verdict schema: `skipped` status added to enum; `⊘` symbol in display; excluded from RED/YELLOW/GREEN aggregation
- Phase 9: expanded from 5 scenarios to 19 (HP-1..5, PF-1..4, GF-1..3, DU-1..3, WT-1..2, IN-1..3) covering every fallback path

**Acknowledged but not fixed (speculative or low-value):**
- Forward-v2 silent acceptance via omitted schema_version: out of scope (explicit-malice scenario)
- jq quote-escaping for non-ASCII label names: label name is fixed ASCII (release-health)
- Concurrent invocation file locking: bounded harm (verdict is audit-only), documented
- Template-placeholder regex single-line limit: placeholders are single-line by definition

### Iteration 3 plan-review fixes (2026-05-31)

Scores: Security 4/5 (↑↑ from 2), Architecture 3/5 (↓ from 4 due to symbol-consistency regression introduced by iter 2), Testing 3/5 (= but 4 of 7 testing gaps are real boundary-coverage misses).

**Real critical gaps fixed (4):**
- Phase 1.5d explicit error wrapper: gh failure or non-`true` jq result → YELLOW, no crash
- Phase 2 dead-code defensive guard for `origin/production` removed (Phase 1.5b already covers it)
- Phase 4 pre-check symbol corrected: `⚠ Phase 4 skipped` → `⊘ Phase 4 skipped` per verdict schema
- Phase 9 expanded with 4 boundary scenarios (HP-6 commit-mismatch + 4 TB-N threshold transitions + WT-3 abandoned-worktree PR); Phase 8b smoke test promoted from optional → mandatory

**Recognized as not-a-plan-gap (1):**
- Architecture agent flagged "gitignore not implemented" — that's an EXECUTION deliverable for Phase 1, not a plan defect. The plan correctly specifies the change in Phase 1 with atomic-commit strategy. Plan readiness ≠ implementation completion.

**Acknowledged but not fixed (Testing's 7→3 remaining as low-priority polish):**
- PR-queue-backlog (>20) threshold test: queue overflow is a slow drift, not a sharp boundary; documented limitation
- Current-worktree CI-passing/approved isolation tests: HP-2 covers the dominant case; full state-matrix is over-engineering for manual validation
- Phase 4 release-PR 6h boundary granularity: covered by TB-4

### Iteration 4 — Consensus Reached ✅ (2026-05-31)

**Scores: Security 5/5, Architecture 5/5, Testing 5/5 — unanimous consensus, no critical gaps remaining.**

All three reviewers independently verified the iter-3 fixes are concretely in place:
- Phase 1.5d explicit error wrapper confirmed (Security)
- Phase 2 dead-code guard removed with explanation (Security)
- Phase 4 `⊘` symbol consistency confirmed (Architecture)
- Gitignore recognized as Phase 1 execution deliverable, not a plan defect (Architecture)
- All 4 new threshold-boundary scenarios (HP-6, TB-1..4, WT-3) present in Phase 9 (Testing)
- Phase 8b smoke test confirmed MANDATORY (Testing)

Plan-review loop converged after 4 iterations across Security (3→2→4→5), Architecture (3→4→3→5), Testing (3→3→3→5). Total: 19 critical gaps identified, addressed, and verified across all iterations.

**Plan is ready for execution. Proceed to Phase 1: create `.claude/commands/safe_to_close.md` + add `.claude/safe-to-close-verdict.json` to `.gitignore` in a single atomic commit.**

[Subsequent /plan-review iterations append here.]
