#!/bin/bash
# Applies OS-level write protection to critical project files.
# Run outside Claude Code: sudo bash scripts/protect-files.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Protecting critical files in $PROJECT_ROOT..."

# Files to make read-only (chmod 444)
READONLY_FILES=(
  "CLAUDE.md"
  "settings.json"
  ".claude/doc-mapping.json"
)

# Glob patterns for read-only files
READONLY_GLOBS=(
  ".claude/hooks/*.sh"
)

# Directories to restrict (chmod 555 - no new file creation)
RESTRICTED_DIRS=(
  ".claude/hooks"
  ".claude/commands"
)

# Apply chmod 444 to individual files
for f in "${READONLY_FILES[@]}"; do
  if [ -f "$f" ]; then
    chmod 444 "$f"
    echo "  chmod 444 $f"
  fi
done

# Apply chmod 444 to glob patterns
for pattern in "${READONLY_GLOBS[@]}"; do
  for f in $pattern; do
    if [ -f "$f" ]; then
      chmod 444 "$f"
      echo "  chmod 444 $f"
    fi
  done
done

# Apply chmod 555 to directories
for d in "${RESTRICTED_DIRS[@]}"; do
  if [ -d "$d" ]; then
    chmod 555 "$d"
    echo "  chmod 555 $d"
  fi
done

# Apply chattr +i (immutable) if available and running as root
if command -v chattr &>/dev/null && [ "$(id -u)" -eq 0 ]; then
  echo "Applying immutable flag (chattr +i)..."
  for f in "${READONLY_FILES[@]}"; do
    if [ -f "$f" ]; then
      chattr +i "$f"
      echo "  chattr +i $f"
    fi
  done
  for pattern in "${READONLY_GLOBS[@]}"; do
    for f in $pattern; do
      if [ -f "$f" ]; then
        chattr +i "$f"
        echo "  chattr +i $f"
      fi
    done
  done
  # Protect this script and unprotect script too
  chmod 444 scripts/protect-files.sh scripts/unprotect-files.sh 2>/dev/null
  chattr +i scripts/protect-files.sh scripts/unprotect-files.sh 2>/dev/null
  echo "  Protected scripts/protect-files.sh and scripts/unprotect-files.sh"
else
  echo "Skipping chattr +i (requires sudo or chattr not available)"
  echo "Files are chmod 444 only — writable by root but not by user"
fi

echo "Done. To edit protected files, run: sudo bash scripts/unprotect-files.sh"
