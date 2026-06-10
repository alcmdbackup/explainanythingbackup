# Build Analysis Skill Research

## Problem Statement
Build a new skill for writing analyses to `/docs/analysis`, which is a renamed version of `/docs/research`. The skill formalizes how data-analysis writeups are produced and stored so they are reproducible: every analysis is linked to a project folder + branch, states its methodology, summarizes key findings, captures a copy of the exact dataset used (CSV when size permits), and records all queries run and their results.

## Requirements (from GH Issue #NNN)
Analysis skill should
- Header
    - Analysis name
    - Should be linked to a project folder and branch
- Make sure outline methodology used
- Summarize key findings
- Save a copy of the exact dataset used if possible in CSV format, if size isn't prohibitive
- Cover all queries used, their results, etc

## High Level Summary
- The repo today has **no `analysis` skill or command** — only `research` (`.claude/commands/research.md`, the project-workflow `_research.md` populater) and `deep-research` (web-research harness). A prior planning project, `docs/planning/simplify_initialize_script_create_research_analysis_command_20260414/`, intended a research/analysis command but never shipped one.
- Analysis-style writeups already exist informally under **`docs/research/`** (e.g. `judging_accuracy_20260412.md`, `judge_agreement_summary_tables.md`), referenced from evolution docs. This is the de-facto "analysis output" location that the new skill should formalize/rename to `docs/analysis/`.
- Data sources for analyses are read-only SQL via **`npm run query:staging` / `npm run query:prod`** (DB-enforced `readonly_local` role, SELECT-only) — the natural source for the "exact dataset" + "all queries used" requirements. `--json` output mode exists for piping. See `docs/docs_overall/debugging.md` and `environments.md`.
- Skill/command specs live in `.claude/commands/*.md` (and `.claude/skills/*/SKILL.md`). CI's `skill-sections-lint` (`scripts/check-skill-sections.sh`, `REQUIRED_SECTIONS`) asserts required section headers per spec — any new skill spec must satisfy/extend it. Never bulk `git checkout -- .claude/` (CLAUDE.md).
- The `research` command is the closest existing template: it finds the project folder by branch, reads project context, follows `project_workflow.md` Step 1, and populates a structured doc. The analysis skill should mirror this shape but emit to `docs/analysis/` and add the dataset-capture + queries-log + methodology requirements.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md — doc structure + reading order; `docs/research/` and `docs/archive/` are historical surfaces
- docs/docs_overall/architecture.md — system design, service layer, Supabase/Pinecone/OpenAI stack
- docs/docs_overall/project_workflow.md — research→plan→progress workflow; research doc template (the analysis skill parallels Step 1)

### Core Operations Docs
- docs/docs_overall/environments.md — read-only DB access (`query:staging`/`query:prod`), the data source for analyses
- docs/docs_overall/testing_overview.md — four-tier testing, check parity (lint/tsc/build/unit/ESM/integration/e2e)
- docs/feature_deep_dives/testing_setup.md — test infra, fixtures, mocking
- docs/docs_overall/debugging.md — read-only SQL query scripts + `--json`; the "queries used / results" mechanism

### Relevant Docs (discovered)
- docs/docs_overall/instructions_for_updating.md — doc maintenance guidelines (a new `docs/analysis/` surface should follow these)

### Evolution Docs (all 14 read for context)
- evolution/docs/README.md, architecture.md, data_model.md, agents/overview.md, cost_optimization.md, rating_and_comparison.md, strategies_and_experiments.md, metrics.md, arena.md, entities.md, reference.md, visualization.md, minicomputer_deployment.md, curriculum.md, logging.md — evolution analyses are a primary consumer of `docs/research/` (e.g. judge-agreement tables feed `rating_and_comparison.md`), so the renamed `docs/analysis/` must keep those cross-references working.

## Code Files Read
- .claude/commands/research.md — closest existing template for the new analysis skill
- (Pending during planning) .claude/commands/initialize.md, scripts/check-skill-sections.sh, scripts/query-*.ts

## Key Findings
1. No `analysis` skill/command exists; `docs/research/` is the de-facto analysis-output location to be renamed `docs/analysis/`.
2. Read-only SQL scripts (`query:staging`/`query:prod`, `--json`) are the source for the dataset + queries-log requirements.
3. New skill specs are CI-linted for required section headers (`scripts/check-skill-sections.sh`) — must be kept coherent in the same PR.
4. Renaming `docs/research/` → `docs/analysis/` will break inbound links from evolution docs (`rating_and_comparison.md` references `docs/research/judge_agreement_summary_tables.md` and `judging_accuracy_20260412.md`) — those must be updated.

## Open Questions
1. Is `docs/research/` to be physically renamed to `docs/analysis/` (moving existing files + fixing all inbound links), or is `docs/analysis/` a new parallel surface with `research` deprecated going forward?
2. Should the skill be a slash command (`.claude/commands/analysis.md`) like `research`, a `.claude/skills/` SKILL, or both?
3. Dataset capture: where do CSVs live (alongside the analysis `.md` in `docs/analysis/<name>/`?) and what is the "size prohibitive" threshold/heuristic?
4. Should the skill auto-run queries via `query:staging`/`query:prod` and capture their output, or just template the section for the human/agent to fill?
