#!/bin/bash
# Removes OS-level write protection from critical project files.
# Run outside Claude Code: sudo bash scripts/unprotect-files.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Unprotecting critical files in $PROJECT_ROOT..."

# Files to restore
READONLY_FILES=(
  "CLAUDE.md"
  "settings.json"
  ".claude/doc-mapping.json"
)

READONLY_GLOBS=(
  ".claude/hooks/*.sh"
)

RESTRICTED_DIRS=(
  ".claude/hooks"
  ".claude/commands"
)

# Remove immutable flag if running as root
if command -v chattr &>/dev/null && [ "$(id -u)" -eq 0 ]; then
  echo "Removing immutable flag (chattr -i)..."
  # Unprotect scripts first so we can modify them
  chattr -i scripts/protect-files.sh scripts/unprotect-files.sh 2>/dev/null || true
  for f in "${READONLY_FILES[@]}"; do
    [ -f "$f" ] && chattr -i "$f" && echo "  chattr -i $f"
  done
  for pattern in "${READONLY_GLOBS[@]}"; do
    for f in $pattern; do
      [ -f "$f" ] && chattr -i "$f" && echo "  chattr -i $f"
    done
  done
fi

# Restore file permissions
for f in "${READONLY_FILES[@]}"; do
  if [ -f "$f" ]; then
    chmod 644 "$f"
    echo "  chmod 644 $f"
  fi
done

for pattern in "${READONLY_GLOBS[@]}"; do
  for f in $pattern; do
    if [ -f "$f" ]; then
      chmod 755 "$f"
      echo "  chmod 755 $f"
    fi
  done
done

# Restore directory permissions
for d in "${RESTRICTED_DIRS[@]}"; do
  if [ -d "$d" ]; then
    chmod 755 "$d"
    echo "  chmod 755 $d"
  fi
done

# Restore script permissions
chmod 755 scripts/protect-files.sh scripts/unprotect-files.sh 2>/dev/null || true

echo "Done. Files are now writable. Re-protect with: sudo bash scripts/protect-files.sh"
