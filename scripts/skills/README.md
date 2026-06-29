[//]: # (Testable extractions of skill orchestration logic. SKILL.md specs reference these modules; tests exercise them directly.)

# scripts/skills/

Testable TypeScript extractions of the load-bearing logic invoked by Claude Code skill specs in `.claude/skills/` and `.claude/commands/`. Skill specs are markdown — the bits that absolutely must not regress (pre-flight gates, idempotency contracts, regex parsers, orchestration glue) live here as pure functions with colocated `*.test.ts` files.

## Invocation contract

Each module exports pure functions for `import` use AND has an optional `if (require.main === module)` CLI block so a SKILL.md spec can invoke it from a shell snippet:

```bash
# Generic shape
npx tsx scripts/skills/<module-name>.ts [subcommand] [args...]
# JSON-on-stdout convention: structured output goes to stdout; errors to stderr.
# Exit code: 0 = success / valid; 1 = failure / invalid; 2 = usage error.
```

When importing from another TS file, use the named exports — do NOT shell out to `npx tsx` from TS code; that's only for the markdown spec → shell layer.

## Modules

| Module | Consumed by | Purpose |
|---|---|---|
| [`wipeout-gate.ts`](./wipeout-gate.ts) | `/run_experiment_analysis` Step 3 | Parses `detectArenaOnlyWipeouts.ts --json` envelope; HARD GATE decision. Decision #13's reuse-not-rewrite. |
| [`manual-run-experiment-capture.ts`](./manual-run-experiment-capture.ts) | `/manual_run_experiment` Step 5; `/run_experiment_analysis` Step 1 | experiment_id regex from seed-script stdout (3 known shapes); idempotency contract for `_status.json.experiment_id`; project-folder resolution from branch name. |
| [`initialize-template-selector.ts`](./initialize-template-selector.ts) | `/initialize` Step 1.5 (4-way branch) + Step 5 (template select) | Maps the user's "Will this involve an experiment?" answer to a `TemplateSelection` (project_kind + which template fragments to include). |
| [`add-experiment-phases-helper.ts`](./add-experiment-phases-helper.ts) | `/add_experiment_phases` | 4 idempotent edits to convert a standard project to feature_with_experiment (PRAP section + Phases 6-10 + evolution docs + project_kind flip). Refuses on already-converted. |
| [`prap-validator.ts`](./prap-validator.ts) | `/run_experiment_analysis` Step 1 pre-flight | Minimum-content validation of `## Pre-Registered Analysis Plan` (requires `arms` + `threshold` + named test). Prevents grep-only bypass. |

## Testing

- All tests use `@jest-environment node` (these are CLI-side modules; jsdom would add noise).
- Run all: `npm test -- --testPathPatterns=scripts/skills`.
- Tests are picked up by the default `jest.config.js` `testMatch` (`**/*.test.ts`) and by `tsconfig.ci.json`'s `scripts/**/*.ts` include.

## Why a separate `scripts/skills/` subdir?

`scripts/` already hosts skill-adjacent utilities (`check-skill-sections.sh`, `summarize-test-results.ts`, `query-db.ts`, etc.). Modules here are specifically the *testable orchestration extractions* invoked by skill specs — grouping them keeps the boundary obvious for future maintainers. tsconfig + Jest both pick them up without extra config.
