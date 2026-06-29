#!/usr/bin/env bash
# Delete stale GitHub Actions cache entries to free space under the 10 GB per-repo cap.
# Targets: (a) caches on refs for PRs that are now MERGED or CLOSED, (b) main-branch caches older than a cutoff date.
# Default is --dry-run; pass --apply to actually delete. Always preview first.

set -euo pipefail

REPO="Minddojo/explainanything"
MAIN_CUTOFF_DATE="2026-05-01"  # delete main-branch caches older than this
APPLY=false

for arg in "$@"; do
  case $arg in
    --apply) APPLY=true ;;
    --dry-run) APPLY=false ;;
    --repo=*) REPO="${arg#*=}" ;;
    --main-cutoff=*) MAIN_CUTOFF_DATE="${arg#*=}" ;;
    -h|--help)
      echo "Usage: $0 [--dry-run | --apply] [--repo=owner/name] [--main-cutoff=YYYY-MM-DD]"
      echo "  --dry-run  (default) preview deletions only"
      echo "  --apply    actually delete via gh api -X DELETE"
      exit 0
      ;;
  esac
done

if $APPLY; then
  echo ">>> APPLY mode — entries will be DELETED"
else
  echo ">>> DRY-RUN mode — no changes will be made (pass --apply to delete)"
fi
echo ">>> Repo:  $REPO"
echo ">>> Main-branch cutoff: $MAIN_CUTOFF_DATE"
echo ""

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# Pull every cache entry. Columns: id, created_at, size, ref, key
gh api "repos/$REPO/actions/caches?per_page=100&sort=created_at&direction=asc" --paginate \
  --jq '.actions_caches[] | "\(.id)\t\(.created_at)\t\(.size_in_bytes)\t\(.ref)\t\(.key)"' \
  > "$TMP/all.tsv"

TOTAL_ENTRIES=$(wc -l < "$TMP/all.tsv")
TOTAL_GB=$(awk -F'\t' '{s+=$3} END {printf "%.2f", s/1024/1024/1024}' "$TMP/all.tsv")
echo ">>> Repo has $TOTAL_ENTRIES cache entries totaling ${TOTAL_GB} GB"
echo ""

# Build the deletion set in two passes
> "$TMP/delete.tsv"

# Pass 1: PR-scoped caches where the PR is MERGED or CLOSED
echo ">>> Pass 1 — checking PR-scoped caches against PR state…"
awk -F'\t' '$4 ~ /^refs\/pull\// {print $4}' "$TMP/all.tsv" | sort -u \
  | sed 's|refs/pull/||;s|/merge||' > "$TMP/pr_refs.txt"
PR_COUNT=$(wc -l < "$TMP/pr_refs.txt")
echo "    $PR_COUNT unique PR refs to check"

while read -r pr; do
  state=$(gh pr view "$pr" --repo "$REPO" --json state --jq '.state' 2>/dev/null || echo "unknown")
  if [[ "$state" == "MERGED" || "$state" == "CLOSED" ]]; then
    awk -F'\t' -v ref="refs/pull/$pr/merge" '$4 == ref' "$TMP/all.tsv" >> "$TMP/delete.tsv"
  fi
done < "$TMP/pr_refs.txt"

# Pass 2: main-branch caches older than the cutoff
echo ">>> Pass 2 — checking main-branch caches older than $MAIN_CUTOFF_DATE…"
awk -F'\t' -v cutoff="$MAIN_CUTOFF_DATE" '
  $4 == "refs/heads/main" && $2 < cutoff
' "$TMP/all.tsv" >> "$TMP/delete.tsv"

DEL_COUNT=$(wc -l < "$TMP/delete.tsv")
DEL_GB=$(awk -F'\t' '{s+=$3} END {printf "%.2f", s/1024/1024/1024}' "$TMP/delete.tsv")
echo ""
echo ">>> Will delete $DEL_COUNT entries totaling ${DEL_GB} GB"
echo ""

if [[ $DEL_COUNT -eq 0 ]]; then
  echo ">>> Nothing to delete. Exiting."
  exit 0
fi

echo ">>> Preview (first 20 entries):"
awk -F'\t' '{ printf "  id=%-10s  %s  %6.1f MB  %-30s  %s\n", $1, $2, $3/1024/1024, $4, substr($5,1,40) }' "$TMP/delete.tsv" | head -20
echo ""

if ! $APPLY; then
  echo ">>> DRY-RUN — no changes made. Re-run with --apply to delete."
  exit 0
fi

echo ">>> Deleting $DEL_COUNT entries via gh api -X DELETE…"
DELETED=0
FAILED=0
while IFS=$'\t' read -r id _; do
  if gh api -X DELETE "repos/$REPO/actions/caches/$id" >/dev/null 2>&1; then
    DELETED=$((DELETED + 1))
  else
    FAILED=$((FAILED + 1))
    echo "  FAILED to delete id=$id"
  fi
done < "$TMP/delete.tsv"

echo ""
echo ">>> Done. Deleted $DELETED, failed $FAILED."
echo ">>> Re-check usage: gh api repos/$REPO/actions/cache/usage"
