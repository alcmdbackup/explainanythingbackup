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
- [x] **Option A (CHOSEN): Slash command `/analysis` modeled on `/research`**: New `.claude/commands/analysis.md` that finds the project by branch, scaffolds `docs/analysis/<name>/` with the required sections, and captures datasets/queries inline. Mirrors the existing research command shape; lowest surprise. (Q2)
- [ ] **Option B: `.claude/skills/analysis/SKILL.md`**: A richer skill with helper scripts for dataset capture + query logging. More capable but heavier; must satisfy `skill-sections-lint`. Rejected — capture is doable as inline spec steps; avoids script-maintenance + lint surface.
- [ ] **Option C: Rename `docs/research/` → `docs/analysis/` only (no skill)**: Pure doc move + link fixes; defers the skill. Rejected — doesn't meet the "build a skill" ask. (The rename itself IS adopted as Phase 2 per Q1.)

## Resolved Decisions (2026-06-11)
- **Q1 — Full rename + fix links:** `git mv docs/research docs/analysis`; update every inbound reference.
- **Q2 — Slash command:** `.claude/commands/analysis.md`, no bundled scripts.
- **Q3 — Per-analysis subfolder + ~1MB cap:** `docs/analysis/<name>/{<name>.md, dataset.csv, queries.sql}`; inline CSV ≤ ~1 MB / ~10k rows, else `sample.csv` + regen query + noted row count.
- **Q4 — Hybrid capture:** active `query:staging/prod --json` → `dataset.csv` + queries/results in-doc for SQL analyses; documented manual fallback for non-SQL sources.

## Research ↔ Analysis Interaction Model (2026-06-11)
The conceptual split the rename reinforces: `<project>_research.md` is the **activity** (transient, branch-scoped working notes in the planning folder, fossilizes after merge); `docs/analysis/<name>/` is the **artifact** (durable, cross-project, citable formal report). `/analysis` is the **distillation/promotion** step that pulls the durable signal out of the working notes *before they fossilize*.

- **Required research doc (Q5):** `/analysis [project-name]` resolves the project folder by branch (like `/research`) and reads `_research.md`. **Errors if absent** — "run `/initialize` → `/research` first." No standalone / bypass-branch mode in v1 (a deliberate constraint; standalone is a possible future escape hatch).
- **Selection, not dump:** candidate findings come from the research doc's `High Level Summary` / `Key Findings`; the runner confirms which are promoted. **1 research doc → N analyses** (e.g. the judge investigation spawned two `docs/research/` reports).
- **Self-contained output:** the analysis copies the promoted findings + adds the reproducibility artifacts (`dataset.csv`, `queries.sql`) the research doc never carried. It must NOT depend on the planning folder remaining accurate after merge.
- **Bidirectional provenance (Q6):**
  - Analysis Header → `Project: docs/planning/<branch>/` + `Branch: <branch>`.
  - `_status.json` → new `analyses: string[]` array listing spawned `docs/analysis/<name>/` dirs.
  - `_research.md` → a `Promoted to: docs/analysis/<name>/` pointer (per promoted analysis).

## Phased Execution Plan

### Phase 1: Decide rename strategy + output layout
- [x] Resolve Open Questions 1-4 from `_research.md` (full rename; slash command; per-analysis subfolder + ~1MB cap; hybrid capture). — done 2026-06-11
- [x] Define the `docs/analysis/` directory + per-analysis layout: `docs/analysis/<name>/<name>.md` + `dataset.csv` + `queries.sql`.

### Phase 2: Establish docs/analysis surface
- [ ] Create `docs/analysis/` (and migrate or alias existing `docs/research/` content per Phase 1 decision).
- [ ] Fix inbound links (evolution `rating_and_comparison.md` references to `docs/research/judge_agreement_summary_tables.md` + `judging_accuracy_20260412.md`).
- [ ] Update `getting_started.md` doc map to list the analysis surface.

### Phase 3: Author the analysis skill
- [ ] Write `.claude/commands/analysis.md` with the required sections: Header (analysis name + project folder + branch link), Methodology, Key Findings, Dataset (CSV capture w/ size guard), Queries & Results.
- [ ] Entry/resolution: resolve project folder by branch (mirror `/research` Step 2); read `_research.md` and **error if absent** ("run /initialize → /research first"). Pull `High Level Summary`/`Key Findings` as the candidate findings; confirm which to promote.
- [ ] Wire hybrid dataset capture + query logging to the read-only SQL scripts (`npm run query:staging` / `query:prod`, `--json`); documented manual fallback for non-SQL sources.
- [ ] Bidirectional provenance: write `Project`/`Branch` into the analysis Header; append the analysis dir to `_status.json.analyses[]`; add a `Promoted to:` pointer in `_research.md`.
- [ ] Extend the `_status.json` schema (and `/initialize` to seed an empty `analyses: []`) so the array is well-formed from project creation.
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
