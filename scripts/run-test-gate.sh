#!/bin/bash
# `npm run test:gate` — runs the local check trio (CI-to-main parity + stricter)
# and writes .claude/test-pass.json with the current HEAD SHA on success.
#
# Scope (stricter than CI-to-main; see docs/feature_deep_dives/pr_verification_gate.md):
#   - lint, typecheck, test:esm (parallel — Phase A)
#   - test (unit FULL), test:integration (FULL) (parallel — Phase B)
#   - test:e2e:critical (Phase C; requires running dev server locally)
#
# Excludes build (CI-to-main also skips it; /finalize runs build separately).
#
# On full success: writes .claude/test-pass.json atomically with the canonical
# tests array. On any failure or SIGINT: deletes any existing test-pass.json
# so a stale "pass" can't unlock the gate.

set -u

cleanup_on_fail() {
  # Remove any existing test-pass.json so a stale pass can't carry over
  rm -f .claude/test-pass.json 2>/dev/null || true
  # Also clean any partial .tmp from a previous interrupted write
  rm -f .claude/test-pass.json.tmp 2>/dev/null || true
}
trap cleanup_on_fail INT TERM

abort() {
  echo "" >&2
  echo "✗ test:gate FAILED at: $1" >&2
  echo "  Fix the failure and re-run \`npm run test:gate\`." >&2
  cleanup_on_fail
  exit 1
}

mkdir -p .claude

echo "→ Phase A: lint + typecheck + test:esm (parallel)"
npm run lint        > /tmp/test-gate-lint.log      2>&1 & pid_lint=$!
npm run typecheck   > /tmp/test-gate-typecheck.log 2>&1 & pid_tc=$!
npm run test:esm    > /tmp/test-gate-esm.log       2>&1 & pid_esm=$!

wait $pid_lint || { cat /tmp/test-gate-lint.log; abort "lint"; }
echo "  ✓ lint"
wait $pid_tc   || { cat /tmp/test-gate-typecheck.log; abort "typecheck"; }
echo "  ✓ typecheck"
wait $pid_esm  || { cat /tmp/test-gate-esm.log; abort "test:esm"; }
echo "  ✓ test:esm"

echo "→ Phase B: unit + integration (parallel)"
npm run test             > /tmp/test-gate-unit.log 2>&1 & pid_unit=$!
npm run test:integration > /tmp/test-gate-int.log  2>&1 & pid_int=$!

wait $pid_unit || { cat /tmp/test-gate-unit.log; abort "unit tests"; }
echo "  ✓ unit"
wait $pid_int  || { cat /tmp/test-gate-int.log; abort "integration tests"; }
echo "  ✓ integration"

echo "→ Phase C: e2e:critical (requires dev server)"

# Local-only: bring up tmux dev server + seed admin test user. In CI,
# playwright.config.ts has a `webServer` block that handles this differently.
if [[ -z "${CI:-}" ]]; then
  if [[ -x "./docs/planning/tmux_usage/ensure-server.sh" ]]; then
    ./docs/planning/tmux_usage/ensure-server.sh || abort "ensure-server.sh"
  fi
  if [[ -x "./scripts/seed-admin-test-user.ts" || -f "./scripts/seed-admin-test-user.ts" ]]; then
    npx tsx scripts/seed-admin-test-user.ts >/dev/null 2>&1 || true
  fi
fi

npm run test:e2e:critical || abort "test:e2e:critical"
echo "  ✓ test:e2e:critical"

echo "→ Phase D: e2e firefox-evolution (opt-in; skipped if firefox not installed)"
RAN_FIREFOX_EVOLUTION=false
# Detect Firefox install. Skip phase if missing — server-side CI matrix
# (ci.yml e2e-evolution Firefox row) is the authoritative enforcement.
if compgen -G "$HOME/.cache/ms-playwright/firefox-*" > /dev/null 2>&1; then
  if npx playwright test --project=firefox --grep=@evolution --grep-invert='@skip-prod' --reporter=line; then
    RAN_FIREFOX_EVOLUTION=true
    echo "  ✓ test:e2e:firefox-evolution"
  else
    abort "test:e2e:firefox-evolution"
  fi
else
  echo "  ⊘ Firefox not installed — skipping (install via 'npx playwright install firefox' to enable)"
fi

# All passed — atomically write test-pass.json
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TMP=".claude/test-pass.json.tmp"

# Append firefox-evolution entry only if Phase D actually ran (audit accuracy)
if [ "$RAN_FIREFOX_EVOLUTION" = "true" ]; then
  TESTS='["lint","typecheck","test:esm","test","test:integration","test:e2e:critical","test:e2e:firefox-evolution"]'
else
  TESTS='["lint","typecheck","test:esm","test","test:integration","test:e2e:critical"]'
fi

jq -n \
  --arg commit "$HEAD_SHA" \
  --arg passed_at "$NOW" \
  --argjson tests "$TESTS" \
  '{
    commit: $commit,
    tests: $tests,
    passed_at: $passed_at,
    schema_version: 1
  }' > "$TMP" || abort "writing test-pass.json"

mv "$TMP" .claude/test-pass.json || abort "installing test-pass.json"

echo ""
echo "✓ test:gate PASSED — wrote .claude/test-pass.json for HEAD ${HEAD_SHA:0:12}"
echo "  The reactive PR-creation gate is now unlocked for this commit."
exit 0
