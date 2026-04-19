# `.claude/lib/` — shell helpers for slash commands

Standalone bash scripts invoked from the bash blocks inside `.claude/commands/*.md` and `.claude/skills/*/SKILL.md` prompt bodies.

## Invocation pattern

**Each bash block inside a slash-command runs in a fresh shell** (empirically verified 2026-04-15 by defining a function in one `Bash` tool call and finding it absent in the next). Therefore `source` does not persist functions across blocks.

**Always invoke helpers as standalone scripts:**

```bash
bash .claude/lib/<helper>.sh <args>
```

Not `source .claude/lib/<helper>.sh && fn_name ...` — the function would disappear between blocks.

## Conventions

- Shebang `#!/usr/bin/env bash` (not `sh`) — helpers use bashisms like `[[`, regex, arrays.
- `set -euo pipefail` at the top so errors surface.
- User-facing messages to **stderr**; machine-readable output to stdout.
- Exit 0 on success or "skipped cleanly"; exit non-zero only on internal error.
- Idempotent where possible (e.g. scaffold writers no-op if target file exists).
- No external dependencies beyond coreutils + git.
- Keep each helper focused — one responsibility per file.

## Current helpers

| Helper | Purpose | Invoked by |
|---|---|---|
| `scaffold_research.sh` | Idempotent `_research.md` writer | `/initialize`, `/research` lazy-create |
| `scaffold_progress.sh` | Idempotent `_progress.md` writer | `/initialize`, `/research` lazy-create |
| `estimate-docs.sh` | Token-cost estimator (`bytes/4`) | `/initialize` Steps 4 and 5 |
| `auto_push_on_consensus.sh` | `git push -u origin HEAD` with safety rails | `/plan-review` on consensus |

Tests under `src/__tests__/unit/skills/*.test.ts` — jest wrappers that shell out to these helpers.
