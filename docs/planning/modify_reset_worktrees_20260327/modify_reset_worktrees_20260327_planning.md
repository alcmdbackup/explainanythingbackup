# Modify Reset Worktrees Plan

## Background
Expand the number of worktrees created by `reset_worktrees` from 5 to 15, and parallelize npm install in batches to keep total setup time reasonable.

## Requirements (from GH Issue #NNN)
Expand number of worktrees supported by reset_worktrees to 15 (user decision, supersedes earlier research that mentioned 20), with parallelized npm install in batches.

## Problem
The `reset_worktrees` script hardcodes `for i in 1 2 3 4 5` on line 126, limiting worktree creation to 5. Additionally, npm install runs sequentially — at ~2-3 min each, 15 sequential installs would take ~30-45 min. Parallelizing in batches (e.g., 5 at a time) reduces this to ~6-9 min total.

## Options Considered
- [x] **Option A: Parameterized count + batched parallel install**: Change loop to `{1..15}`, split into batches of 5 for parallel npm install. Simple, safe, handles failures per batch.
- [ ] **Option B: Fully parallel (all 15 at once)**: Maximum speed but risks disk I/O contention and makes error reporting harder.
- [ ] **Option C: Just expand the loop, keep sequential**: Simplest change but ~30-45 min wall time is unacceptable.

## Phased Execution Plan

### Phase 1: Add configurable variables and disk space check
- [x] Add `NUM_WORKTREES=15` variable near top of script (line ~22)
- [x] Add `BATCH_SIZE=5` variable near top of script
- [x] Add disk space pre-flight check after variables:
  ```bash
  # Pre-flight disk space check (~5GB per worktree)
  REQUIRED_GB=$((NUM_WORKTREES * 5))
  AVAILABLE_GB=$(df -BG --output=avail "$PARENT_DIR" | tail -1 | tr -d ' G')
  if [ "$AVAILABLE_GB" -lt "$REQUIRED_GB" ]; then
      echo -e "${RED}Error: Need ~${REQUIRED_GB}GB but only ${AVAILABLE_GB}GB available in $PARENT_DIR${NC}"
      exit 1
  fi
  echo "Disk check: ${AVAILABLE_GB}GB available, ~${REQUIRED_GB}GB needed"
  ```

### Phase 2: Restructure loop into two passes
- [x] Change line 125 comment from "Create five worktrees" to "Create $NUM_WORKTREES worktrees"
- [x] Change line 126 from `for i in 1 2 3 4 5; do` to `for i in $(seq 1 $NUM_WORKTREES); do`
- [x] **Pass 1 (sequential)**: Keep the existing loop body for git worktree creation, env file copy, and Claude settings copy — but **remove npm install from the loop**. Collect worktree paths into an array:
  ```bash
  WORKTREE_PATHS=()
  for i in $(seq 1 $NUM_WORKTREES); do
      # ... existing git worktree add, env copy, claude settings copy ...
      WORKTREE_PATHS+=("$WORKTREE_PATH")
  done
  ```
- [x] **Pass 2 (batched parallel npm install)**: Add after the sequential loop:
  ```bash
  # Pass 2: Parallel npm install in batches (isolated caches to prevent corruption)
  echo -e "\n${BLUE}Step 3c: Installing dependencies in parallel (batch size: $BATCH_SIZE)...${NC}"

  INSTALL_FAILED=()
  for ((start=0; start<${#WORKTREE_PATHS[@]}; start+=BATCH_SIZE)); do
      BATCH_NUM=$((start/BATCH_SIZE + 1))
      echo -e "\n${BLUE}Batch $BATCH_NUM...${NC}"
      PIDS=()
      BATCH_WTS=()
      for ((j=start; j<start+BATCH_SIZE && j<${#WORKTREE_PATHS[@]}; j++)); do
          wt="${WORKTREE_PATHS[$j]}"
          BATCH_WTS+=("$wt")
          # Use per-worktree npm cache to avoid cache corruption during parallel writes
          (cd "$wt" && npm install --legacy-peer-deps --cache "$wt/.npm-cache" \
              > "$wt/npm-install.log" 2>&1) &
          PIDS+=($!)
      done

      # Wait for batch and check results
      for idx in "${!PIDS[@]}"; do
          if ! wait "${PIDS[$idx]}"; then
              INSTALL_FAILED+=("${BATCH_WTS[$idx]}")
              echo -e "  ${RED}✗ FAILED: ${BATCH_WTS[$idx]}${NC}"
          else
              echo -e "  ${GREEN}✓ $(basename "${BATCH_WTS[$idx]}")${NC}"
          fi
      done
      echo -e "${GREEN}Batch $BATCH_NUM complete${NC}"
  done

  # Report results
  if [ ${#INSTALL_FAILED[@]} -gt 0 ]; then
      echo -e "\n${RED}${#INSTALL_FAILED[@]} worktree(s) failed npm install:${NC}"
      for wt in "${INSTALL_FAILED[@]}"; do
          echo -e "  ${RED}✗ $wt (see $wt/npm-install.log)${NC}"
      done
      echo -e "\n${RED}Successful worktrees are usable. Re-run npm install manually in failed ones.${NC}"
      exit 1
  fi
  ```
- [x] Add comment explaining `set -e` does not apply to background processes — explicit PID wait handles errors instead
- [x] Update completion summary at end of script to reflect `$NUM_WORKTREES`

### Phase 3: Verify existing cleanup handles scaling
- [x] Verify line 28 `find "$PARENT_DIR" -maxdepth 1 -type d -name "worktree_*"` cleans up all old worktrees (it does — pattern is generic)
- [x] Verify line 69 `git branch --list "git_worktree_*"` cleans up all branches (it does — pattern is generic)
- [x] No changes needed — cleanup already handles any number of worktrees/branches

### Phase 4: Housekeeping
- [x] Add `.npm-cache/` and `npm-install.log` to `.gitignore` (prevent accidental commits from worktrees)
- [x] After all batches succeed, clean up per-worktree npm caches to reclaim disk:
  ```bash
  for wt in "${WORKTREE_PATHS[@]}"; do
      rm -rf "$wt/.npm-cache" "$wt/npm-install.log"
  done
  ```

### Notes on design decisions
- **Per-worktree npm cache** (`--cache "$wt/.npm-cache"`): Prevents concurrent cache corruption, a known npm issue. Cache dirs are cleaned up after successful install.
- **Continue-on-failure**: Unlike the original `exit 1` on first failure, this collects all failures and reports at the end. Successful worktrees remain usable.
- **Port allocation**: Verified safe — 900-port range (3100-3999) easily handles 15 concurrent worktrees (1.7% occupancy).
- **Pass 1 fail-fast is intentional**: Git worktree creation failures (Pass 1) indicate systemic issues (branch conflicts, disk full), so `set -e` aborting early is correct. Only npm install (Pass 2) uses continue-on-failure.
- **Disk estimate**: 5GB/worktree is conservative (includes npm-cache overhead). Caches are cleaned post-install.

## Testing

### Unit Tests
- [x] N/A — this is a bash script, not TypeScript

### Integration Tests
- [x] N/A

### E2E Tests
- [x] N/A

### Manual Verification
- [ ] Run `bash reset_worktrees` and verify:
  - 15 worktrees created in parent directory
  - All have node_modules installed
  - All have .env files copied
  - All have .claude settings copied
  - Batched output shows 3 batches of 5 completing
- [ ] Verify `git worktree list` shows 16 entries (main + 15)
- [ ] Verify a Claude Code session starts successfully in worktree_X_15 (highest index)
- [ ] Spot-check npm-install.log files are created and clean
- [ ] Run script twice in a row (idempotency test) — verify old worktrees cleaned up, new ones created cleanly
- [ ] Test disk space check by temporarily setting REQUIRED_GB very high and confirming script aborts
- [ ] Simulate npm install failure in one worktree (e.g., corrupt package.json) and verify:
  - Script continues with remaining worktrees
  - Failed worktrees are reported at the end
  - Successful worktrees have working node_modules

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [x] `bash -n reset_worktrees` — syntax check the script
- [ ] `shellcheck reset_worktrees` — lint the script (not available without sudo)



## Documentation Updates
- [x] Update comment on line 125 of `reset_worktrees` from "five" to reflect NUM_WORKTREES
- [x] Add `.npm-cache/` and `npm-install.log` to `.gitignore`

## Review & Discussion

### Iteration 1 (3 agents)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | npm cache contention in parallel installs; `set -e` + background process interaction |
| Architecture & Integration | 3/5 | Research/plan count mismatch (20 vs 15); npm cache contention; partial failure leaves dirty state |
| Testing & CI/CD | 3/5 | No partial failure recovery; no disk space check; no npm cache contention test |

**Fixes applied:**
1. Added per-worktree npm cache (`--cache "$wt/.npm-cache"`) to prevent corruption
2. Changed from fail-fast (`exit 1`) to continue-on-failure with summary report — successful worktrees remain usable
3. Added disk space pre-flight check before creating worktrees
4. Clarified research/plan count: user chose 15, noted in Requirements section
5. Added `set -e` comment explaining background process behavior
6. Made shellcheck required, not optional
7. Added idempotency test and failure simulation to manual verification

### Iteration 2 (3 agents)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 0 — minor: .gitignore for cache/logs, disk estimate tuning |
| Architecture & Integration | 5/5 | 0 — all gaps resolved |
| Testing & CI/CD | 4/5 | 0 — minor: npm timeout, log cleanup, Pass 1 fail-fast rationale |

**Fixes applied:**
1. Added Phase 4 (Housekeeping): `.npm-cache/` and `npm-install.log` added to `.gitignore`, cache cleanup after successful install
2. Documented Pass 1 fail-fast as intentional design decision
3. Clarified disk estimate includes cache overhead and caches are cleaned post-install
