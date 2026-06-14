# /analysis - Create a Formal Analysis Report

Distill the useful findings in a project's research doc into a durable, reproducible **analysis report** under `docs/analysis/`. An analysis is the formal artifact promoted from the transient `_research.md` working notes; it is self-contained and survives the planning folder going stale after merge.

## Usage

```
/analysis <project-name>
```

- `project-name` (optional): project name or partial match. If omitted, resolves by the current git branch (like `/research`).

## Execution Steps

### 1. Resolve the project (lifted from /research Steps 1-2)
- Resolve the project folder in `docs/planning/` by `<project-name>` or, if omitted, by the current branch.
- If multiple match, list them and ask the user to disambiguate.

### 2. Require a research doc
- Read the project's `*_research.md`.
- **If absent, abort:** `"No research doc for branch <X>. Run /initialize then /research first."`
- If it exists but `## High Level Summary` AND `## Key Findings` are both empty, warn and prompt the user to populate them via `/research` before continuing.

### 3. Select findings to promote
- Present `## High Level Summary` + `## Key Findings` as candidate findings.
- Ask the user which to promote into this analysis (1 research doc → N analyses). Copy the promoted findings into the report (self-contained); do not merely link them.

### 4. Scaffold the report
- Choose a kebab-case `<name>` (suffix the date if not already dated).
- Create `docs/analysis/<name>/<name>.md` using the **Template** below, plus `dataset.csv` and `queries.sql` as produced in Step 5.

### 5. Capture the dataset + queries (hybrid)
- **SQL-driven:** run `npm run query:staging -- --json "<query>"` (or `query:prod`) for each query; write the returned rows to `docs/analysis/<name>/dataset.csv`; record every raw query in `queries.sql`; paste each query + its result into `## Queries & Results`.
- **Non-SQL** (logs, Honeycomb, external CSV): fill `## Dataset` and `## Queries & Results` manually, describing the source and how it was pulled.
- **Size guard:** inline the full CSV when ≤ ~1 MB / ~10k rows. Above that, store a representative `sample.csv` + the exact regeneration query in `queries.sql` + note the full row count in `## Dataset`.
- **PII safety (required):** the read-only DB role guards against writes, NOT against committing sensitive output. Prefer aggregates; exclude PII columns (`email`, raw user `query` text, auth identifiers) unless the analysis specifically needs them AND the user confirms. Before finishing, print: `"Confirm dataset.csv contains no PII before committing."`

### 6. Write bidirectional provenance
- In the report's `## Header`: set `Project:` to `docs/planning/<branch>/` and `Branch:` to the branch.
- In `_status.json`: **append** `"docs/analysis/<name>/"` to `analyses[]` (treat a missing key as `[]` and initialize it; skip if already present — idempotent).
- In `*_research.md`: create a `## Promoted Analyses` section if absent (appended at end of file), then append `- docs/analysis/<name>/` (skip if already listed). Never rewrite existing research content.

### 7. Output summary
- Print the report path, the dataset row count, and the provenance writes made.

## Template

The report at `docs/analysis/<name>/<name>.md` MUST contain these sections:

```markdown
# <Analysis Name>

## Header
- **Analysis name:** <name>
- **Project:** docs/planning/<branch>/
- **Branch:** <branch>
- **Date:** <YYYY-MM-DD>
- **Source research doc:** <path to _research.md>

## Methodology
[How the analysis was conducted: what was measured, the data source, how the
dataset + queries were captured, and any caveats affecting reproducibility.]

## Key Findings
[Numbered, durable findings promoted from the research doc — the formal result.]

## Dataset
[Reference to dataset.csv (or sample.csv + full row count when over the size cap).
Note PII handling. Inline a small table when helpful.]

## Queries & Results
[Every query used and its result. For SQL: the exact command + the returned rows.
For non-SQL: the source and pull method. Cross-reference queries.sql.]
```

## Notes
- `/analysis` requires a research doc by design (no standalone/bypass-branch mode in v1).
- Legacy flat reports at `docs/analysis/` root predate the subfolder convention and stay flat; new analyses always use a `<name>/` subfolder.
- The 5 `## ` headers above are enforced by `scripts/check-skill-sections.sh`; if you rename one, update that script in the same PR.
