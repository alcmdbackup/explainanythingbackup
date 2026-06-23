---
description: Verdict + recommendations on whether the current branch / repo state is safe to close (no open PRs across worktrees, plan complete, finalize artifacts valid, no un-promoted migrations or release-health blockers).
argument-hint: [--update-docs] [--dry-run]
allowed-tools: Bash(git:*), Bash(gh:*), Bash(jq:*), Read, Edit, Write, AskUserQuestion
---

# /safe_to_close — Verdict on close-readiness

Aggregates 8 close-readiness signals across 5 categories. Returns GREEN / YELLOW / RED, prints a verdict block, writes `.claude/safe-to-close-verdict.json` for audit, and (opt-in via `--update-docs`) appends a Closeout section to research/planning/progress docs.

## Arguments

- `--update-docs` — opt-in mutation that appends a "Closeout" block to `_research.md` / `_planning.md` / `_progress.md` derived from git log + plan's "Review & Discussion" + one AskUserQuestion. Default: skip.
- `--dry-run` — print the verdict and the would-be doc-update diff, but mutate no files. Pairs with `--update-docs` to preview the doc-update step without applying it.

Parse `$ARGUMENTS` once at the top:
```bash
DRY_RUN=0; UPDATE_DOCS=0
for arg in $ARGUMENTS; do
  case "$arg" in
    --dry-run)     DRY_RUN=1 ;;
    --update-docs) UPDATE_DOCS=1 ;;
  esac
done
```

---

## Phase 1.5 — Pre-flight (runs on EVERY invocation)

Pre-flight failures **do NOT abort the command**. Each failure produces a YELLOW banner above the verdict and sets a shell variable consumed by the downstream phase that depends on it. Order matters: cheapest local check first, network calls last, auth gated before any network call.

```bash
PREFLIGHT_WARNINGS=()

# 1.5a — local: workflow file exists
if [ ! -f .github/workflows/e2e-nightly.yml ]; then
  PREFLIGHT_WARNINGS+=("Workflow file e2e-nightly.yml missing — Phase 5 nightly check disabled")
  NIGHTLY_OK=0
else
  NIGHTLY_OK=1
fi

# 1.5b — local: both refs present
if git rev-parse --verify origin/main >/dev/null 2>&1 \
   && git rev-parse --verify origin/production >/dev/null 2>&1; then
  REFS_OK=1
else
  REFS_OK=0
  PREFLIGHT_WARNINGS+=("Run: git fetch origin main production — Phase 4 will skip until refs are present")
fi

# 1.5c — network: gh auth gates 1.5d
if gh auth status >/dev/null 2>&1; then
  GH_AUTH_OK=1
else
  GH_AUTH_OK=0
  PREFLIGHT_WARNINGS+=("Run: gh auth login — Phases 2/5/6 will skip")
fi

# 1.5d — network: label existence (only if 1.5c passed)
if [ $GH_AUTH_OK -eq 1 ]; then
  if gh label list --search release-health --json name \
       --jq 'map(select(.name=="release-health")) | length > 0' 2>/dev/null \
       | grep -qx true; then
    LABEL_OK=1
  else
    LABEL_OK=0
    PREFLIGHT_WARNINGS+=("Label \`release-health\` missing or unreachable — Phase 5 issue check will report unknown")
  fi
else
  LABEL_OK=0  # gated by 1.5c, no further message
fi
```

Display:
```
Pre-flight warnings:
  ⚠ <warning 1>
  ⚠ <warning 2>
```
(omit the section entirely if `PREFLIGHT_WARNINGS` is empty)

---

## Phase 2 — Worktree + PR scan

- Enumerate worktrees: `git worktree list --porcelain`
- Filter out placeholder slots whose branch matches `^refs/heads/git_worktree_[0-9_]+$`
- If `GH_AUTH_OK=0`, skip entire phase with status `skipped`; verdict row prints `⊘ Phase 2 skipped — gh auth missing`
- Single `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft,url,updatedAt 2>/dev/null` call. If non-zero exit → YELLOW (whole phase warn, never crash).
- Surface **every** open PR — none collapsed by age. For each:

| Condition | Color | Annotation |
|---|---|---|
| Current worktree, PR open, CI passing AND approved | YELLOW | "ready to merge — finalize complete; PR #N" |
| Current worktree, PR open, CI failing OR unapproved | RED | "active work in flight; PR #N" |
| Other worktree, PR open (ANY age) | RED | `<worktree-path> — PR #N — last activity $DAYS days ago`; if `>30 days` append "STALE — $DAYS days" |
| Branch with commits ahead of `origin/main`, no PR | YELLOW | "unpushed commits on $WORKTREE/$BRANCH — was /finalize skipped?" |
| Branch on `main`/`production` or merged into either | (silent) | OK |
| Draft PR (`isDraft: true`) | same as above + " (draft)" |

Display the full list of open PRs in a table — never collapse.

---

## Phase 3 — Plan + finalize-artifact scan (current worktree only)

**Locate planning doc** via `_status.json` reverse-index (preferred over three-path lookup):
```bash
BRANCH=$(git branch --show-current)
STATUS_FILES=$(grep -Frl "\"branch\": \"$BRANCH\"" docs/planning/*/_status.json 2>/dev/null)
STATUS_FILE=$(echo "$STATUS_FILES" | sort -V | tail -1)
```
- Zero matches → YELLOW "no planning doc for branch $BRANCH — was /initialize run?"; skip checkbox scan
- Multiple matches → `sort -V | tail -1` picks the most recent project folder

**Code-fence-aware checkbox scan** of `$(dirname $STATUS_FILE)/*_planning.md`:
- Track open/close ``` fence state (toggle on lines beginning with ```)
- Outside fences: count `- [ ]` (unchecked) and `- [x]`/`- [X]` (checked)
- **Template-placeholder filter**: exclude lines matching the regex `^- \[ \] \[.*\]$` (literal-bracket placeholders carried over from initialize template)
- If unchecked > 0 → RED with `file:line` list

**Gate files** — each JSON read includes `schema_version` validation with explicit three-state semantics:
- Field absent → treat as v1 (omit-tolerant for gate files written by current `/finalize`)
- Field present AND value == 1 → GREEN proceed
- Field present AND value ≠ 1 → YELLOW "gate file `$FILE` has schema_version=$N (expected 1) — /safe_to_close may misread"

**`.claude/push-gate.json`**:
- Missing → RED "/finalize not run on this branch"
- Exists AND `.commit == git rev-parse HEAD` → GREEN
- Exists AND `.commit != HEAD` → RED, **inline diff**: `git log $(jq -r .commit .claude/push-gate.json)..HEAD --oneline`

**`.claude/test-pass.json`**:
- Exists AND `.commit == HEAD` AND `.tests | length >= 6` AND `.schema_version == 1` (or absent) → GREEN
- Otherwise → YELLOW (optional unlock for ci-gate=closed only)

**`.claude/ci-gate.json`** — status enum map:
- `"open"` → GREEN
- `"pending"` → YELLOW ("CI still in progress")
- `"closed"` → RED ("CI observed failing — see `gh pr checks`")
- `"unknown"` / missing → YELLOW ("CI state not yet observed")

**jq parse failure** on any gate file → YELLOW with offending file path; never crash.

---

## Phase 4 — Post-deploy migrations + backports

**Pre-check**: if `REFS_OK=0` (Phase 1.5b YELLOW), skip entire Phase 4 with status `skipped`; verdict row prints `⊘ Phase 4 skipped — refs missing`. Do NOT re-fetch.

**Minicomputer evolution-runner sync** (always runs; non-fatal):

The minicomputer's `evolution-runner` systemd timer does NOT auto-pull, so a worktree at `/home/ac/Documents/ac/explainanything-worktree0` may sit on a stale commit after every main merge — which silently runs the evolution pipeline against outdated code. `/safe_to_close` performs the fast-forward pull on the operator's behalf so close-out is reliable.

Use `git -C <path>` (NOT `cd`) so the current project's working directory is preserved.

```bash
MINI_WORKTREE=/home/ac/Documents/ac/explainanything-worktree0
if [ -d "$MINI_WORKTREE/.git" ] || [ -f "$MINI_WORKTREE/.git" ]; then
  # Status snapshot BEFORE the pull (so we can report what advanced)
  BEFORE_SHA=$(git -C "$MINI_WORKTREE" rev-parse --short HEAD 2>/dev/null || echo "?")

  # Fetch + ff-only pull. Captures stdout AND stderr; never exits non-zero into the outer script.
  PULL_OUTPUT=$(git -C "$MINI_WORKTREE" pull --ff-only origin main 2>&1) || PULL_EXIT=$?
  PULL_EXIT=${PULL_EXIT:-0}

  AFTER_SHA=$(git -C "$MINI_WORKTREE" rev-parse --short HEAD 2>/dev/null || echo "?")

  if [ $PULL_EXIT -ne 0 ]; then
    MINI_STATUS=warn
    MINI_DETAIL="git pull --ff-only failed at $MINI_WORKTREE (exit $PULL_EXIT). $(echo "$PULL_OUTPUT" | head -1)"
  elif [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
    MINI_STATUS=ok
    MINI_DETAIL="Already current at $AFTER_SHA"
  else
    MINI_STATUS=ok
    MINI_DETAIL="Advanced $BEFORE_SHA → $AFTER_SHA"
  fi
else
  # Worktree absent (e.g. running on a machine without the minicomputer mount). Skip silently.
  MINI_STATUS=skipped
  MINI_DETAIL="No worktree at $MINI_WORKTREE — skipped"
fi
```

Verdict row:
- `MINI_STATUS=ok` AND already current → `✓ Minicomputer worktree: $MINI_DETAIL` (GREEN)
- `MINI_STATUS=ok` AND advanced → `✓ Minicomputer worktree: $MINI_DETAIL` (GREEN, surfaced so operator sees a sync happened)
- `MINI_STATUS=warn` → `⚠ Minicomputer worktree: $MINI_DETAIL` (YELLOW, **never RED** — a failed pull is recoverable)
- `MINI_STATUS=skipped` → `⊘ Minicomputer worktree: $MINI_DETAIL` (excluded from aggregation)

Common failure modes that produce YELLOW (operator can still close, but should investigate):
- Uncommitted local changes on the minicomputer worktree (`fatal: Not possible to fast-forward, aborting`)
- Diverged from `origin/main` (`fatal: Not possible to fast-forward`)
- Network outage to GitHub
- Missing `origin` remote on that worktree

**Un-promoted migrations**:
```bash
UNPROMOTED=$(git diff --name-only origin/production..origin/main -- 'supabase/migrations/*.sql')
```
- Empty → GREEN
- Non-empty → RED with file list + age of each (`git log -1 --format=%ai $FILE`)

**Known limitation**: file-presence check, not schema-aware. False positives possible if a migration file was added then deleted; acceptable since false positives are safer than false negatives.

**Un-released commits**:
```bash
UNRELEASED_COUNT=$(git log origin/main ^origin/production --oneline | wc -l)
OLDEST_UNRELEASED=$(git log origin/main ^origin/production --format=%at | tail -1)  # oldest commit
```
- 0 commits → GREEN
- ≥1 commits, oldest ≤ 14 days → YELLOW "$N commits awaiting release; oldest $DAYS days ago"
- oldest > 17 days → RED "release cadence stalled — consider /mainToProd"

**Active PRs in flight** (symmetric across both bases):
- **Release PRs**: `gh pr list --base production --state open --json number,title,createdAt,statusCheckRollup`
  - None → GREEN
  - Open < 6h → YELLOW "release in flight — PR #N — your close may race with it"
  - Open ≥ 6h → RED "release PR stalled — check CI"
- **Main-targeting PRs**: `gh pr list --base main --state open --json number,title,author,createdAt,updatedAt,statusCheckRollup,headRefName`
  - Any with CI failing AND `updatedAt > 24h` → RED "PR #N (@author): CI failing $DAYS days — release queue blocker"
  - Total open count > 20 → YELLOW "$N PRs to main — queue backlog growing"
  - Otherwise → GREEN
- **Abandoned-worktree PRs**: cross-reference `gh pr list --author @me --base main --state open` against `git worktree list` branches. Any open PR whose `headRefName` doesn't appear in any worktree → RED "PR #N — no worktree found; was the worktree deleted before merge?"

No reverse check needed (hotfixes go through main first).

---

## Phase 5 — Release-health signals

**Nightly E2E status** (skip with `⊘` if `NIGHTLY_OK=0` or `GH_AUTH_OK=0`):
```bash
gh run list --workflow=e2e-nightly.yml --branch=main --limit=2 --json conclusion,createdAt
```
- Latest = `success` → GREEN
- Latest = `failure`/`cancelled`, prior = `success` → YELLOW "nightly red, 1 night"
- Latest 2 both `failure`/`cancelled` → RED "nightly red ≥ 2 nights — see release-health issues"

**Open release-health issues** (skip with `⊘` if `LABEL_OK=0` or `GH_AUTH_OK=0`):
```bash
gh issue list --label release-health --state open --json number,title,createdAt
```
- None → GREEN
- Any open ≤ 12h old → YELLOW
- Any open > 12h old → RED with link to oldest issue

All `gh` calls in Phase 5 wrap in `|| YELLOW(...)` for unexpected failure.

---

## Phase 6 — Verdict display + state file

**Compute color per row**, then aggregate:
- `GREEN` = all ✓; `RED` = any ✗; `YELLOW` = any ⚠ with no ✗. `⊘ skipped` rows are excluded from aggregation.

**Verdict block** (modeled on `/finalize` Step 0d):
```
Safe to Close Verdict
──────────────────────────────────────
Worktree PR state:        ✓ / ⚠ / ✗ / ⊘  (N open across worktrees — full list below)
Current plan checkboxes:  ✓ / ✗ / ⊘  (N unchecked)
/finalize artifacts:      ✓ / ⚠ / ✗ / ⊘
Un-promoted migrations:   ✓ / ✗ / ⊘  (N files, oldest $DAYS days)
Un-released commits:      ✓ / ⚠ / ✗ / ⊘  (N commits, oldest $DAYS days)
Active PRs in flight:     ✓ / ⚠ / ✗ / ⊘  (release: N | main: N open, N stalled, N abandoned-worktree)
Minicomputer worktree:    ✓ / ⚠ / ⊘  (pull status, before→after SHA or skipped reason)
Nightly E2E:              ✓ / ⚠ / ✗ / ⊘
Release-health issues:    ✓ / ⚠ / ✗ / ⊘
──────────────────────────────────────
VERDICT: GREEN | YELLOW | RED
```

For every ✗ and ⚠, print a **Next action** hint:

| Signal | Hint |
|---|---|
| Un-promoted migrations | `Run: /mainToProd` |
| Nightly red ≥ 2 | `Check: gh issue list --label release-health --state open` + link to debugging.md |
| Stalled release PR | `Check: gh pr checks <PR#>` |
| Stalled main-targeting PR with failing CI | `Check: gh pr checks <PR#>` + `Notify: @author` |
| Abandoned-worktree PR | `Run: gh pr view <PR#>` then either `git worktree add` or `gh pr close <PR#>` |
| Push-gate stale | `Run: /finalize` (or accept typo-only diff and re-finalize) |
| Plan checkboxes unchecked | line numbers + `Run: /plan-update` |
| Minicomputer pull failed | `Run: git -C /home/ac/Documents/ac/explainanything-worktree0 status` to inspect; resolve uncommitted/diverged state, then `git -C ... pull --ff-only origin main` |

**State file** (RED or YELLOW only): write `.claude/safe-to-close-verdict.json`:
```json
{
  "schema_version": 1,
  "verdict": "red|yellow|green",
  "checked_at": "ISO timestamp",
  "checked_sha": "<HEAD SHA>",
  "checks": {
    "<check_name>": {
      "status": "ok|warn|fail|skipped",
      "detail": "...",
      "skipped_reason": "..."
    }
  }
}
```
- `status` enum: `ok` (✓ GREEN), `warn` (⚠ YELLOW), `fail` (✗ RED), `skipped` (⊘ — phase skipped due to Phase 1.5 pre-flight YELLOW)
- `skipped_reason` required when status == `skipped`; references the Phase 1.5 sub-step
- Verdict display rendering: `⊘ skipped` rows appear but are excluded from RED/YELLOW/GREEN aggregation
- File is gitignored (per `.claude/` convention)
- Not re-entrant: concurrent invocations may clobber — bounded harm (audit-only)

---

## Phase 7 — Doc-update step (opt-in via `--update-docs`)

Only runs if `UPDATE_DOCS=1` AND `DRY_RUN=0`. (`--dry-run --update-docs` prints the would-be diff but applies nothing.)

**Pre-flight guards** (all produce YELLOW skip rather than crash):
- **Detached HEAD**: `git symbolic-ref -q HEAD >/dev/null 2>&1 || YELLOW("Detached HEAD — skipping doc update")`
- **No project folder found** (Phase 3 reverse-index returned zero matches): skip Phase 7 entirely with YELLOW "No planning doc — nothing to update"
- **Read-only docs**: for each of `_research.md`, `_planning.md`, `_progress.md`, check `[ -w "$file" ]`; if not writable, YELLOW-skip that file with "$file is read-only — skipped"; continue with the rest
- **Missing docs**: if any of the three target docs does not exist, YELLOW-skip with "$file missing"; do NOT create it

**Three sources** for "all discussions" (transcripts are inaccessible to the harness):
1. `git log origin/main..HEAD --format='%h %s%n%b' --no-merges` — what shipped
2. Planning doc's existing "Review & Discussion" section — what was already captured
3. **One** AskUserQuestion: "Any final notes to capture before closing? (deferred work, late decisions, surprises)"

**Markdown safety**: before applying each Edit, validate the merged (existing + new) result. "Unbalanced fences" is defined operationally as: `grep -c '^```' "$file_with_new_block_appended" % 2 != 0` (odd count of ``` lines). If unbalanced, YELLOW-skip with "potential markdown corruption — skipped".

**Append targets**:
- `_progress.md`: append final phase `## Phase N+1: Closeout` with subsections Work Done / Issues Encountered / User Clarifications (derived from the three sources)
- `_planning.md` "Review & Discussion": append `### Closeout Notes` block (mirrors `/plan-review` iteration-append pattern)
- `_research.md`: append `## Post-Execution Findings` ONLY if user provided notes that contradict or extend original research

All edits via Edit tool, preserving existing structure. If `--dry-run`, print the diff that would be applied and skip the Edit calls.

---

## Exit code

- Verdict GREEN → exit 0
- Verdict YELLOW → exit 0 (informational)
- Verdict RED → exit 1 (so shell scripts can chain on `&& /safe_to_close && /mainToProd`)
- Internal crash (unexpected) → exit 2

---

## Known limitations

- File-presence migration check (not schema-aware) — false positives possible on add-then-delete; tradeoff prefers safety over precision
- Reused branch names → picks most-recent project folder via `sort -V | tail -1`
- Transcript-based discussion capture impossible (harness limitation) — Phase 7 uses git log + plan section + one user prompt
- Not re-entrant — concurrent invocations may clobber `.claude/safe-to-close-verdict.json` (audit-only)
- No reverse `production ^main` check — hotfixes go through main first
- Minicomputer worktree path is hardcoded (`/home/ac/Documents/ac/explainanything-worktree0`) — Phase 4 silently skips on machines where that path doesn't exist; if the minicomputer mount point changes, update the path in `MINI_WORKTREE`. Operator's responsibility to keep the worktree healthy (no diverged state, clean tree) — the pull is fast-forward-only and never merges or rebases.

## Related

- `/finalize` — writes `push-gate.json` and `test-pass.json` that this command reads
- `/mainToProd` — promotes main to production (the action recommended by this command's RED signals)
- `/plan-review` — appends iteration summaries to "Review & Discussion" (Phase 7's append target)
- `docs/feature_deep_dives/pr_verification_gate.md` — push-gate / test-pass / ci-gate schemas
