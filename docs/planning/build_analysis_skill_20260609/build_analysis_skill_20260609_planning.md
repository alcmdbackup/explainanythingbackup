# Build Analysis Skill Plan

## Background
Build a new skill for writing analyses to `/docs/analysis`, which is a renamed version of `/docs/research`. The skill formalizes how data-analysis writeups are produced and stored so they are reproducible: every analysis is linked to a project folder + branch, states its methodology, summarizes key findings, captures a copy of the exact dataset used (CSV when size permits), and records all queries run and their results.

## Requirements (from GH Issue #1186)
Analysis skill should
- Header
    - Analysis name
    - Should be linked to a project folder and branch
- Make sure outline methodology used
- Summarize key findings
- Save a copy of the exact dataset used if possible in CSV format, if size isn't prohibitive
- Cover all queries used, their results, etc

## Problem
Analyses today are written ad-hoc into `docs/research/` with no consistent structure, no reproducibility guarantees (methodology, exact dataset, queries), and no link back to the originating project/branch. There is no skill to scaffold or enforce this. We want a renamed, structured `docs/analysis/` surface plus a skill that produces compliant analysis docs.

## Options Considered
- [ ] **Option A: Slash command `/analysis` modeled on `/research`**: New `.claude/commands/analysis.md` that finds the project by branch, scaffolds `docs/analysis/<name>/` with the required sections, and captures datasets/queries. Mirrors the existing research command shape; lowest surprise.
- [ ] **Option B: `.claude/skills/analysis/SKILL.md`**: A richer skill with helper scripts for dataset capture + query logging. More capable but heavier; must satisfy `skill-sections-lint`.
- [ ] **Option C: Rename `docs/research/` → `docs/analysis/` only (no skill)**: Pure doc move + link fixes; defers the skill. Cheapest but doesn't meet the "build a skill" ask.

## Phased Execution Plan

### Phase 1: Decide rename strategy + output layout
- [ ] Resolve Open Questions 1-4 from `_research.md` (rename vs parallel surface; command vs skill; CSV location/threshold; auto-run vs template).
- [ ] Define the `docs/analysis/` directory + per-analysis layout (e.g. `docs/analysis/<name>/<name>.md` + `dataset.csv` + `queries.sql`).

### Phase 2: Establish docs/analysis surface
- [ ] Create `docs/analysis/` (and migrate or alias existing `docs/research/` content per Phase 1 decision).
- [ ] Fix inbound links (evolution `rating_and_comparison.md` references to `docs/research/judge_agreement_summary_tables.md` + `judging_accuracy_20260412.md`).
- [ ] Update `getting_started.md` doc map to list the analysis surface.

### Phase 3: Author the analysis skill
- [ ] Write the skill spec (command and/or SKILL per Phase 1) with the required sections: Header (analysis name + project folder + branch link), Methodology, Key Findings, Dataset (CSV capture w/ size guard), Queries & Results.
- [ ] Wire dataset capture + query logging to the read-only SQL scripts (`npm run query:staging` / `query:prod`, `--json`).
- [ ] Update `scripts/check-skill-sections.sh` `REQUIRED_SECTIONS` for the new skill in the SAME change.

### Phase 4: Verify + document
- [ ] Generate one example analysis doc end-to-end to validate the template.
- [ ] Update docs (getting_started, instructions_for_updating) to reference the new skill.

## Testing

### Unit Tests
- [ ] If helper scripts are added (dataset capture / query logging): colocated `.test.ts` covering CSV serialization + size-threshold guard.

### Integration Tests
- [ ] N/A unless the skill ships a script that touches the DB — if so, an integration test using `query:staging` read-only role.

### E2E Tests
- [ ] N/A (no UI surface).

### Manual Verification
- [ ] Run the skill on this branch and confirm it produces a compliant `docs/analysis/<name>/` doc linked to project + branch.
- [ ] Confirm `scripts/check-skill-sections.sh` passes for the new spec.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes.

### B) Automated Tests
- [ ] `bash scripts/check-skill-sections.sh` (skill-sections-lint parity)
- [ ] `npm run lint && npm run typecheck && npm run build` if any TS helper scripts are added
- [ ] `npm run test:unit -- <helper>.test` if helper scripts are added

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/instructions_for_updating.md` — add the `docs/analysis/` surface + analysis-skill conventions.
- [ ] `docs/docs_overall/getting_started.md` — list `docs/analysis/` in the doc map.
- [ ] `evolution/docs/rating_and_comparison.md` — repoint `docs/research/*` links if the directory is renamed.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
