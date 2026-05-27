# enforce_no_pr_without_fixing_issues_locally_20260526 Research

## Problem Statement
Block Claude Code from creating PRs unless local verification has run successfully, while preserving a deliberate user-controlled escape hatch. Today the codebase enforces a **push gate** (`.claude/hooks/block-push-without-gate.sh`) that prevents `git push` to `main`/`production` without a fresh `.claude/push-gate.json` — but `gh pr create` itself is completely ungated, and any branch prefixed `fix/`, `docs/`, `chore/` bypasses the push gate as well. Claude can therefore create a PR with unverified code through several paths today.

## Requirements (from user)
Block Claude Code from creating PRs without first verifying changes locally, unless specifically approved by the user.

## High Level Summary

**The shape of the gap.** The existing infrastructure assumes the *push* is the chokepoint for unverified code reaching `main`. That stopped being true once `gh pr create` could be invoked directly: Claude can push to a feature branch (which is unconditionally allowed), then call `gh pr create --base main` against that branch. No hook intercepts the second step. The `fix/`/`docs/`/`chore/` bypass on `block-push-without-gate.sh` widens the gap further — those branches can even skip the push gate today.

**The fix is well-scoped.** PR creation has a single chokepoint in this codebase (`gh pr create` in `finalize.md:849` and `mainToProd.md:171`), and the contract for adding a `PreToolUse` Bash-matcher hook is well-understood (the existing push-gate hook is a 110-line reference implementation). The mechanism: a new hook intercepts `gh pr create`/`gh pr ready`/`gh api .*pulls.*POST`, validates the same `.claude/push-gate.json` that `/finalize` already writes, and emits a deny JSON when invalid. A sibling `.claude/pr-approval.json` (written by a new escape-hatch slash command) provides the "specifically approved by the user" path.

**Why the gate file is a meaningful signal.** `/finalize`'s pre-push check set is the **strict superset** of CI's check set for PRs to `main` — full unit suite vs. CI's `--changedSince`, full integration suite vs. CI's critical-only, plus a local `npm run build` that CI skips. So `.claude/push-gate.json` existing for the current HEAD is a stronger signal than "CI will pass" — it's "I ran the checks CI would have run, plus more."

**Evidence the problem is real.** Recent history shows 5+ concrete incidents in the last 3 months where a PR was created with code that local verification would have caught — including a migration referencing a non-existent column (commit `0bbe1ab8`), 4 ESLint serial-mode errors merged then fixed up (`39537ece`), and a fire-and-forget perf change that broke 2 integration tests (`6a9684f1`). The repo also has 29 `wip: push for local viewing` commits in 6 months, which is a tell for "ship now, fix the CI red later." This work closes the path that allows that habit.

## Documents Read
- `docs/docs_overall/getting_started.md` — doc index, reading order
- `docs/docs_overall/architecture.md` — system shape, service/action patterns, tech stack
- `docs/docs_overall/project_workflow.md` — Step 1-8 execution model, push-gate language
- `.claude/commands/finalize.md` — Step 7 writes `.claude/push-gate.json`; Step 8 monitors CI
- `.claude/hooks/block-push-without-gate.sh` — reference implementation for the new hook
- `.claude/hooks/enforce-ci-monitoring.sh` — Stop-hook pattern; same `hookSpecificOutput` schema
- `docs/docs_overall/testing_overview.md` — "Check Parity: Local vs CI" table; flakiness rules
- `docs/feature_deep_dives/testing_setup.md` — test tiers, commands, scope per target branch

## Code Files Read (and what we learned from each)
- `.claude/hooks/block-push-without-gate.sh` — exact deny-JSON shape, `TOOL_INPUT` env-var contract, branch-prefix bypass list, gate freshness check via SHA match.
- `.claude/hooks/check-workflow-ready.sh` — `WORKFLOW_BYPASS=true` env-var escape, stdin JSON reading via `input=$(cat)`, use of `$CLAUDE_PROJECT_DIR`.
- `.claude/hooks/enforce-ci-monitoring.sh` — Stop-hook output uses `decision: "block"` / `reason:` (different key names than PreToolUse).
- `.claude/commands/finalize.md` — Step 7 line that writes the gate file: `echo "{\"commit\":\"$(git rev-parse HEAD)\",...}" > .claude/push-gate.json`. Sets the schema we'll reuse.
- `.claude/commands/mainToProd.md` — also writes the same gate file, also calls `gh pr create`.
- `.claude/settings.json` — hook registration shape (matcher: "Bash" / "Edit" / "Write"; hooks array with `type: "command"`).

## Key Findings

1. **PR creation has a single chokepoint today.** Only `/finalize` and `/mainToProd` invoke `gh pr create`. No CI workflow auto-creates PRs. Adding one hook for `gh pr create` covers ~100% of the in-codebase surface.

2. **`gh pr create` is completely ungated.** The push-gate (`block-push-without-gate.sh`) only intercepts `git push` to `main`/`production`. Pushes to feature branches are allowed unconditionally. `gh pr create` runs after the push and has no hook.

3. **Branch-prefix bypasses are too lenient for the new hook.** The push-gate exempts `hotfix/`, `fix/`, `docs/`, `chore/`. For PR creation, only `hotfix/` makes sense as a bypass (emergency response). `fix/`, `docs/`, `chore/` should be gated — a fix or doc change still gets a CI run; "I'm pretty sure this is small" is exactly the rationale that produced past incidents.

4. **Hook contract is well-understood.** `PreToolUse` Bash matcher; read `TOOL_INPUT` env var; emit `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` to stdout; **exit 0 for both allow and deny** (decision is the JSON, not the exit code). Reference: `block-push-without-gate.sh`.

5. **`/finalize`'s gate is a strict superset of CI to main.** `/finalize` runs full unit, full integration, full ESM, lint, typecheck, build, and E2E `@critical` — locally. CI to main runs `--changedSince` unit, critical-only integration, and `@critical` E2E. So a valid `.claude/push-gate.json` for the current HEAD means "I just ran everything CI would have run, and more." We can reuse the existing gate file rather than introducing a second one.

6. **Approval idiom: lightweight per-branch token file, time-windowed.** The codebase's existing escape-hatch patterns rank as: branch-prefix (too coarse, branch-wide), `WORKFLOW_BYPASS=true` env (session-wide, no audit), `// @silent-ok:` magic comment (code-only, doesn't apply to tool calls). The recommended pattern for *this* gate is a per-branch JSON token written by an explicit slash command, auto-committed for audit, with a 30-minute validity window. Schema: `{"branch":"feat/x","approved_at":"ISO","reason":"..."}`.

7. **Loopholes worth plugging in v1.** Beyond `gh pr create`, the matcher should also catch `gh pr ready` (draft → ready), `gh api repos/.../pulls -X POST` (REST API bypass), and substring-match `bash -c "gh pr create"` (wrapper evasion). Out-of-scope for v1: Playwright MCP clicking "Create pull request" on the GitHub web UI — documented as a known gap.

8. **Test pattern exists.** `scripts/test-bypass-safety-hooks.sh` is a table-driven shell harness that invokes hooks with synthetic `TOOL_INPUT` and asserts on the JSON output. The new hook should ship with `scripts/test-block-pr-without-gate.sh` following the same shape — no new test framework needed.

9. **Kill switches are important.** Hook-based enforcement that "feels broken" under pressure is worse than no enforcement. Three kill switches in priority order: (a) per-invocation env var like `DISABLE_PR_CREATE_GATE=true`, (b) `.claude/settings.local.json` override, (c) deleting the hook line from `.claude/settings.json`. The hook should honor (a) explicitly.

## Open Questions

- **Q1 — Approval window length.** Recommended default is 30 min (long enough to address the verification gap, short enough that the approval doesn't outlive the situation). Confirm? Alternatives: 1 hour, single-use (consumed on first PR create), no expiry.
- **Q2 — Branch-prefix bypass policy.** Recommended: only `hotfix/` bypasses; `fix/`, `docs/`, `chore/` are gated. Confirm? The user may want `docs/` exempt (docs PRs genuinely don't need test runs).
- **Q3 — Approval slash command name.** Two options: `/approve-pr` (short, consistent with existing `/finalize` naming) or `/approve-pr-without-finalize` (explicit, harder to type — friction by design). Which?
- **Q4 — Should the approval file be auto-committed?** Committing creates a permanent audit trail in git history. Not committing keeps the working tree cleaner but makes "why did this PR skip checks?" un-answerable later. Recommendation: commit, but make it a single commit on top of HEAD that is benign to revert.
- **Q5 — Stop-hook companion?** Should a corresponding Stop-hook also fire when Claude tries to end a session while a PR exists on a non-bypass branch *without* a valid gate? Today `enforce-ci-monitoring.sh` blocks Stop only when CI is failing. This would extend it to "PR exists but was never verified" — possibly overkill, possibly the natural completion of the design.
- **Q6 — Playwright MCP gap.** Acknowledged as out of scope for v1. Should the planning doc include a Phase 2 to revisit, or accept it as a permanent gap (since human review on github.com is itself a form of approval)?

## Synthesis: What the Plan Will Look Like

The plan will have three phases, each independently revertable:

- **Phase 1** — Ship `.claude/hooks/block-pr-without-gate.sh` and register it in `.claude/settings.json`. Reuses `.claude/push-gate.json` as the primary gate. Branch-prefix bypass: `hotfix/` only. Kill switch: `DISABLE_PR_CREATE_GATE=true` env var. Tests: `scripts/test-block-pr-without-gate.sh`.
- **Phase 2** — Ship `.claude/commands/approve-pr.md` (name TBD per Q3). Writes `.claude/pr-approval.json` after AskUserQuestion + reason prompt. Auto-commits.
- **Phase 3** — Documentation: a section in `project_workflow.md` documenting the new gate, the escape hatch, and the kill switch. Update `CLAUDE.md` if needed.

The user-facing UX once shipped:
1. Claude tries `gh pr create` without `/finalize` having run → hook denies with a clear message ("Run /finalize first, or use /approve-pr if you really want to skip").
2. User runs `/finalize` → checks pass → gate written → `gh pr create` allowed.
3. OR user runs `/approve-pr` → AskUserQuestion confirms intent → reason captured → `.claude/pr-approval.json` written + committed → `gh pr create` allowed for 30 min.
4. Emergency: `DISABLE_PR_CREATE_GATE=true gh pr create ...` works without any of the above (audit trail in shell history only).
