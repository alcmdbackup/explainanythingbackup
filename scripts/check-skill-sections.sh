#!/usr/bin/env bash
# Required-sections lint for skill specs.
#
# Why this exists: in May 2026, PR #1110 silently deleted ~330 lines from
# .claude/commands/mainToProd.md via a wholesale "catch up .claude/ drift"
# overwrite. The removed lines included Step 7.4 (Backport Fixes to Main)
# and Step 7.5 (Migration-Present Warning). The May-27 release squash
# carried the regression into production. Nothing flagged the deletion at
# review or in CI because the file was syntactically valid markdown.
#
# This script asserts that each skill spec contains specific section
# headers. If any header is missing on a PR, CI fails — so an accidental
# deletion can't slip through review.
#
# To intentionally rename or remove a section: update the REQUIRED_SECTIONS
# entries below in the SAME PR as the spec change. The lint and the spec
# stay coherent.

set -u  # NOT set -e — we want to report ALL missing sections, not stop at first.

declare -A REQUIRED_SECTIONS

REQUIRED_SECTIONS[".claude/commands/mainToProd.md"]="
### 1. Setup
### 2. Merge Main
### 3. Resolve Conflicts
### 4. Run All Verification Checks
### 4.5. E2E Tests
### 5. Commit
### 6. Push and Create PR
### 6.1. Backup Pushes
### 6.2. Monitor CI Checks
### 7. Verify and Cleanup
#### 7.4 Backport Test Fixes to Main
### 8. Post-Merge Backup Sync
### 9. Migration-Present Warning
"

REQUIRED_SECTIONS[".claude/commands/finalize.md"]="
"

REQUIRED_SECTIONS[".claude/commands/write_doc_for_completed_analysis.md"]="
## Header
## Methodology
## Key Findings
## Dataset
## Queries & Results
"

REQUIRED_SECTIONS[".claude/commands/run_experiment_analysis.md"]="
## Workflow
## Pre-flight Gates
## EAR Output Template
## Header
## Methodology
## Key Findings
## Dataset
## Queries & Results
## Pre-Registered Analysis Plan
## Balance Audit
## Decisiveness Audit
## Causal Evidence
## Adversarial Review Log
"

REQUIRED_SECTIONS[".claude/skills/analysis-review-loop/SKILL.md"]="
## When to Use
## Workflow
## Reviewer JSON Schema
## Stop Condition
"

REQUIRED_SECTIONS[".claude/commands/add_experiment_phases.md"]="
## Usage
## Pre-conditions
## Actions
"

fail=0
for file in "${!REQUIRED_SECTIONS[@]}"; do
  if [ ! -f "$file" ]; then
    echo "::error file=$file::skill spec file missing entirely"
    fail=1
    continue
  fi
  while IFS= read -r section; do
    [ -z "$section" ] && continue
    if ! grep -qF "$section" "$file"; then
      echo "::error file=$file::missing required section header: $section"
      fail=1
    fi
  done <<< "${REQUIRED_SECTIONS[$file]}"
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "One or more skill specs are missing required section headers."
  echo "If you intentionally renamed or removed a section, update"
  echo "REQUIRED_SECTIONS in scripts/check-skill-sections.sh in the same PR."
  exit 1
fi

echo "✓ All required skill-spec sections present"
