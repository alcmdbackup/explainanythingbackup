#!/usr/bin/env bash
# Doc-cost estimator: prints token/context table and returns tier verdict.
# Usage: bash .claude/lib/estimate-docs.sh <file1> [file2 ...]
# Exit codes: 0 = auto-proceed (Tier 1), 1 = confirm recommended (Tier 2), 2 = refuse (Tier 3)
# All output to stderr (table + verdict) so the caller can capture exit code cleanly.

set -uo pipefail

CONTEXT_WINDOW=200000

if [[ $# -eq 0 ]]; then
  echo "Usage: bash .claude/lib/estimate-docs.sh <file1> [file2 ...]" >&2
  exit 1
fi

total_tokens=0

printf "%-60s %6s %8s %6s %s\n" "Doc" "Lines" "~Tokens" "%200k" "Tier" >&2
printf "%-60s %6s %8s %6s %s\n" "---" "-----" "-------" "-----" "----" >&2

for f in "$@"; do
  if [[ ! -f "$f" ]]; then
    printf "%-60s %6s %8s %6s %s\n" "$f" "-" "-" "-" "MISSING" >&2
    continue
  fi

  bytes=$(wc -c < "$f")
  lines=$(wc -l < "$f")
  tokens=$((bytes / 4))
  pct_tenths=$((tokens * 1000 / CONTEXT_WINDOW))
  pct_whole=$((pct_tenths / 10))
  pct_frac=$((pct_tenths % 10))

  # Tier classification
  tier="T3"
  case "$f" in
    docs/docs_overall/getting_started.md|docs/docs_overall/architecture.md|docs/docs_overall/project_workflow.md)
      tier="T1" ;;
    docs/docs_overall/*|docs/feature_deep_dives/*)
      tier="T2" ;;
  esac

  printf "%-60s %6d %8d %4d.%d%% %s\n" "$f" "$lines" "$tokens" "$pct_whole" "$pct_frac" "$tier" >&2

  total_tokens=$((total_tokens + tokens))
done

total_pct_tenths=$((total_tokens * 1000 / CONTEXT_WINDOW))
total_pct_whole=$((total_pct_tenths / 10))
total_pct_frac=$((total_pct_tenths % 10))

printf "%-60s %6s %8d %4d.%d%%\n" "TOTAL" "" "$total_tokens" "$total_pct_whole" "$total_pct_frac" >&2

# Verdict
total_pct=$((total_tokens * 100 / CONTEXT_WINDOW))
if [[ $total_pct -gt 40 ]]; then
  echo "VERDICT: REFUSE (>40% of context). Override with explicit approval." >&2
  exit 2
elif [[ $total_pct -gt 5 ]]; then
  echo "VERDICT: CONFIRM (5-40% of context). Recommend reviewing the table above." >&2
  exit 1
else
  echo "VERDICT: AUTO (<5% of context). Proceeding." >&2
  exit 0
fi
