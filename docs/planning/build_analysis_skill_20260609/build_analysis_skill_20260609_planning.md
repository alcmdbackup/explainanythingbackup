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
- **Option B (rejected): `.claude/skills/analysis/SKILL.md`**: A richer skill with helper scripts for dataset capture + query logging. More capable but heavier; must satisfy `skill-sections-lint`. Rejected — capture is doable as inline spec steps; avoids script-maintenance + lint surface.
- **Option C (rejected): Rename `docs/research/` → `docs/analysis/` only (no skill)**: Pure doc move + link fixes; defers the skill. Rejected — doesn't meet the "build a skill" ask. (The rename itself IS adopted as Phase 2 per Q1.)

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

> **Single PR, ordered execution.** All phases land in one PR on this branch. Strict intra-PR order: **(2)** `git mv` rename + fix active links → **(3a)** add the `check-skill-sections.sh` entry + update `/initialize` Step 3.5 (`analyses: []`) → **(3b)** write `.claude/commands/analysis.md` → **(4)** generate the example + update docs. The lint entry and the spec MUST be in the same commit (the script's own coherence rule). The Verification/Testing gates below are **post-execution checks** — they pass once the phases are complete and are run during this project's `/finalize`, not before; an unbuilt artifact failing them now is expected, not a plan defect.

### Phase 1: Decide rename strategy + output layout
- [x] Resolve Open Questions 1-4 from `_research.md` (full rename; slash command; per-analysis subfolder + ~1MB cap; hybrid capture). — done 2026-06-11
- [x] Define the `docs/analysis/` directory + per-analysis layout: `docs/analysis/<name>/<name>.md` + `dataset.csv` + `queries.sql`.

### Phase 2: Establish docs/analysis surface
- [x] `git mv docs/research docs/analysis` (moves the two existing files: `judge_agreement_summary_tables.md`, `judging_accuracy_20260412.md`). This single move *creates* `docs/analysis/` — no separate bootstrap commit needed.
- [x] Fix inbound links in **active/maintained docs only** (enumerated from a full `grep -rn "docs/research/" --include="*.md"`):
  - `evolution/docs/rating_and_comparison.md:11` (`../../docs/research/judge_agreement_summary_tables.md`)
  - `evolution/docs/rating_and_comparison.md:86` (`../../docs/research/judging_accuracy_20260412.md`)
  - `evolution/docs/strategies_and_experiments.md:104` (`docs/research/judge_agreement_summary_tables.md`)
- [x] **Do NOT rewrite historical planning-doc snapshots** that reference `docs/research/` (7 files under `docs/planning/*/`: `further_speedup_20260413`, `create_tool_systematic_judge_evaluation_evolutioN_20260606`, `updated_criteria_agent_20260505`, `bring_back_debate_agent_20260506`, `understand_critera_agent_performance_evolution_20260503`, `simplify_initialize_script_create_research_analysis_command_20260414`). Per `getting_started.md`, planning docs are frozen historical records; editing them falsifies the record. Their now-stale links are an accepted, documented consequence of choosing full-rename over the redirect-stub option (Q1). See "Accepted Tradeoffs" below.
- [x] **Verification gate (manual):** after fixes, re-run `grep -rn "docs/research/" --include="*.md" . | grep -v docs/planning/` and confirm **zero** hits outside historical planning docs. (No CI link-checker exists — this grep IS the gate; record it in the Verification section.)
- [x] Update `getting_started.md` doc map: replace the `docs/research/` historical-surface line with `docs/analysis/` and describe it as the durable analysis-report surface produced by `/analysis`.

### Phase 3: Author the analysis skill
- [x] Write `.claude/commands/analysis.md` embedding the **analysis-doc template** with these exact section headers (these become the REQUIRED_SECTIONS contract): `## Header` (fields: Analysis name, Project, Branch), `## Methodology`, `## Key Findings`, `## Dataset`, `## Queries & Results`.
- [x] Entry/resolution: **lift `/research` Steps 1-2 verbatim** (project-by-branch resolution) rather than reinvent. Read `_research.md`; **error if absent** with message `"No research doc for branch <X>. Run /initialize then /research first."`. If `_research.md` exists but `High Level Summary` AND `Key Findings` are both empty → warn and prompt to populate via `/research` before continuing.
- [x] Selection step: present `High Level Summary` + `Key Findings` as candidate findings; user confirms which to promote (1 research doc → N analyses). The promoted findings are **copied** into the analysis (self-contained), then enriched with the NEW sections (`Methodology`, `Dataset`, `Queries & Results`) that the research doc never carried.
- [x] Hybrid dataset capture (per "Dataset Capture & PII Safety" below): for SQL analyses run `npm run query:staging`/`query:prod --json` → write to `docs/analysis/<name>/dataset.csv` (size-guarded) and paste each query + result into `## Queries & Results`; record the raw queries in `queries.sql`. Documented manual fallback for non-SQL sources (logs/Honeycomb/external CSV).
- [x] Bidirectional provenance (per "_status.json Schema Delta" below): write `Project`/`Branch` into the analysis `## Header`; **append-and-dedupe** the analysis dir to `_status.json.analyses[]` (treat a missing `analyses` key as `[]` and initialize it on first write — handles projects created before this change); in `_research.md`, **create the `## Promoted Analyses` section if absent (appended at end of file)** then append the analysis dir as a bullet, **skipping if that dir is already listed** (idempotent re-run). Never rewrite existing `_research.md` content.
- [x] **Same-PR `/initialize` + schema change:** update `.claude/commands/initialize.md` Step 3.5 template to seed `"analyses": []` in `_status.json`. Document that `analyses[]` is **additive/optional** — existing consumers (`/finalize`, hooks, `/safe_to_close`) ignore unknown/absent fields (precedent: `relevantDocs`), so no migration of existing `_status.json` files is required and nothing breaks. Surfacing `analyses[]` in `/finalize` is an explicit **non-goal for v1** (follow-up).
- [x] Update `scripts/check-skill-sections.sh`: add a `REQUIRED_SECTIONS[".claude/commands/analysis.md"]` entry listing the 5 template headers above, IN THE SAME PR (per the script's own coherence rule). This lints the command spec's embedded template — if a future edit deletes e.g. the `## Dataset` section, CI fails.

### Phase 4: Verify + document
- [x] Generate one example analysis end-to-end at `docs/analysis/example_analysis_skill_smoketest_20260611/` (small, SQL-driven, ≤10 rows) to validate the template + capture flow + provenance writes. Confirm it passes `check-skill-sections.sh` and the dangling-link grep.
- [x] Update `docs/docs_overall/getting_started.md` (doc map) and `docs/docs_overall/instructions_for_updating.md` (add the `docs/analysis/` surface + analysis conventions) to reference the new skill.
- [x] Decide whether the smoketest example stays as a canonical sample or is removed before PR (default: keep as the documented reference example).

## Testing

### Unit Tests
- [x] If helper scripts are added (dataset capture / query logging): colocated `.test.ts` covering CSV serialization + size-threshold guard.

### Integration Tests
- [x] N/A unless the skill ships a script that touches the DB — if so, an integration test using `query:staging` read-only role.

### E2E Tests
- [x] N/A (no UI surface).

### Manual Verification
- [x] **Dangling-link grep gate:** `grep -rn "docs/research/" --include="*.md" . | grep -v docs/planning/` returns zero hits (all active references repointed; historical planning snapshots intentionally excluded).
- [x] Run `/analysis` on this branch (Phase 4 example) and confirm it produces a compliant `docs/analysis/<name>/` doc with all 5 required sections, linked to project + branch, with `_status.json.analyses[]` and the `_research.md` `## Promoted Analyses` pointer updated.
- [x] Confirm `bash scripts/check-skill-sections.sh` passes (new `analysis.md` entry enforced).
- [x] Confirm a moved file resolves: open `evolution/docs/rating_and_comparison.md` rendered links and verify they point at `docs/analysis/...`.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes.

### B) Automated Tests
- [x] `bash scripts/check-skill-sections.sh` (skill-sections-lint parity — MUST include the new `analysis.md` entry, else this gate is hollow)
- [x] `bash -c 'grep -rn "docs/research/" --include="*.md" . | grep -v docs/planning/ | grep -c . | grep -qx 0 && echo OK'` — dangling-link gate, fails if any active reference remains
- [x] `python3 -c "import json;json.load(open('docs/planning/build_analysis_skill_20260609/_status.json'))"` and confirm `analyses` key present + an array (JSON well-formed after schema change)
- [x] No TS helper scripts are added (Q2 = slash command only), so lint/tsc/build/unit are N/A for this project unless that changes.

> **No CI link-checker exists** and docs-only PRs take the CI fast path (lint+tsc only), so CI will not catch a dangling `docs/research/` link. The dangling-link grep is therefore an **execution-time manual gate** the executor runs during this project's verification (Manual Verification, above) before opening the PR — it is NOT a permanent new `/finalize` step (adding one is out of scope; see Accepted Tradeoffs).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/instructions_for_updating.md` — add the `docs/analysis/` surface + analysis-skill conventions.
- [x] `docs/docs_overall/getting_started.md` — replace the `docs/research/` historical-surface line with `docs/analysis/` in the doc map.
- [x] `evolution/docs/rating_and_comparison.md` (lines 11, 86) — repoint the two `docs/research/*` links.
- [x] `evolution/docs/strategies_and_experiments.md` (line 104) — repoint the `docs/research/judge_agreement_summary_tables.md` link.
- [x] `.claude/doc-mapping.json` — no `docs/research/`/`docs/analysis/` pattern exists today; `/analysis` is a pure-docs command that touches no code, so **no doc-mapping entry is required**. Recorded here so reviewers don't re-flag it.

## _status.json Schema Delta
Current shape (from `/initialize` Step 3.5): `{ branch, created_at, prerequisites, relevantDocs[] }`. This project adds one **additive** field:

```jsonc
{
  "branch": "...",
  "created_at": "...",
  "prerequisites": { ... },
  "relevantDocs": [ ... ],
  "analyses": ["docs/analysis/<name>/"]   // NEW — array of analysis dir paths (strings, trailing slash)
}
```

- **Entry type:** plain string dir paths (e.g. `"docs/analysis/judge_latency_20260611/"`). Not objects — keeps it parallel to `relevantDocs[]` and trivially diffable. The analysis name + branch live inside the analysis doc's `## Header`, not duplicated here.
- **Write semantics:** `/analysis` does **append-and-dedupe** (no-op if the path already present) so re-running on the same project is idempotent.
- **Backward compatibility:** the field is optional and additive. `/initialize` seeds `"analyses": []` for new projects; existing `_status.json` files without the key are valid — `/analysis` treats a missing key as `[]` and initializes it on first write. The new field has **zero readers** today (verified): `/finalize` does not read `_status.json` at all (it keys doc-updates off `.claude/doc-mapping.json`); the `track-prerequisites.sh` hook reads only `prerequisites`/`branch`; `/safe_to_close` does not key on `analyses`. So the field is strictly safe — no migration of existing files needed.

## Dataset Capture & PII Safety
The "save the exact dataset as CSV" requirement runs queries against staging/prod, which can return user PII (emails, IDs, raw query text). Committing that to git is a leak that outlives deletion. The skill spec MUST encode:

- **Default to non-PII columns / aggregates.** Prefer `SELECT count(*), date_trunc(...)`-style aggregate result sets over raw row dumps. When row-level data is needed, **exclude PII columns** (no `email`, no raw `userQueries.query` user text, no auth identifiers) unless the analysis specifically requires them AND the user explicitly confirms.
- **Read-only is enforced, sensitivity is not.** `query:staging`/`query:prod` use a DB-enforced read-only role (safe against writes) but that does NOT make the OUTPUT safe to commit. The size cap (≤1MB/10k rows) is a repo-hygiene guard, not a privacy guard — call this out so they're not conflated.
- **Reviewer checklist line:** the skill prints a pre-commit reminder: "Confirm `dataset.csv` contains no PII before committing." Captured datasets are real user data from prod even on a docs-only PR.

## Layout: existing flat files vs new subfolders
- Existing files moved by the rename (`judge_agreement_summary_tables.md`, `judging_accuracy_20260412.md`) **stay flat** at `docs/analysis/<file>.md` — they're historical and retroactively foldering them would churn the inbound links we just fixed for no benefit.
- **New** analyses use `docs/analysis/<name>/` subfolders (doc + dataset.csv + queries.sql).
- This two-tier layout is **accepted and documented** (Option B). `getting_started.md` + the skill spec state the rule: "legacy flat reports + new subfoldered reports coexist; new analyses always use a subfolder." No automated consumer enumerates `docs/analysis/` (it's reference docs, not code), so the mixed layout has no functional consumer to confuse.

## Rollback Plan
The change is one PR with two coupled parts (rename + command). Rollback paths:
- **Pre-merge, Phase 2 lands but Phase 3 fails:** all changes are in the feature branch only; `git checkout main -- .` / branch reset discards everything. Nothing reaches `main` until the PR merges, so there is no half-broken intermediate state on a shared branch.
- **Post-merge regret:** revert the squash-merge commit. `git mv` is a normal content move, fully reversible by the revert; `_status.json` `analyses[]` becomes dormant (additive field, ignored); `.claude/commands/analysis.md` + the `check-skill-sections.sh` entry are removed together by the revert, keeping the lint coherent.
- **Ordering safety:** because the lint entry and the spec land in the same commit, there is never a state where CI references a spec that doesn't exist or vice-versa.

## Accepted Tradeoffs
- **Stale links in historical planning docs.** Full rename (Q1, redirect-stub explicitly declined) means 7 frozen planning-doc snapshots keep `docs/research/` links that now 404. Accepted: those docs are historical records, not maintained surfaces; rewriting them would falsify the record. The grep gate explicitly excludes `docs/planning/` for this reason.
- **No standalone `/analysis`.** Requiring a research doc (Q5) blocks bypass-branch + ad-hoc use. Accepted as a v1 constraint; standalone is a documented future escape hatch.
- **No CI link-checker.** Adding one is out of scope; the manual grep gate substitutes. Recorded so it isn't re-flagged.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

### Iteration 1 (2026-06-11) — all reviewers 2/5
Critical gaps raised (Security/Architecture/Testing) and their resolutions:
- `_status.json` not seeded in `/initialize` / no schema definition / idempotency → added **_status.json Schema Delta** section (exact JSON, string entries, append-dedupe, additive-compat) + made the `/initialize` Step 3.5 edit an explicit same-PR Phase 3 item.
- `check-skill-sections.sh` REQUIRED_SECTIONS not specified / lint would leave new spec unchecked → Phase 3 now lists the exact 5 headers to add as the `analysis.md` entry; verified the script keys by file path so a command spec is eligible.
- Incomplete link audit → Phase 2 enumerates all 3 active link sites + the 7 historical files to leave; added the manual grep gate (active surfaces only).
- No CI link-checker / hollow verification → Verification section now states the grep gate is a required manual gate (CI fast-path won't catch it).
- PII leakage via committed CSVs → added **Dataset Capture & PII Safety** section.
- No rollback plan → added **Rollback Plan** section.
- Mixed flat/subfolder layout → added **Layout** section (accept + document, Option B).
- Missing `/finalize` + consumer integration / `/research` mutation semantics → schema-delta section documents additive-compat + no consumer reads it; Phase 3 specifies append-only `## Promoted Analyses` in `_research.md`; finalize-surfacing scoped as explicit v1 non-goal.

### Iteration 2 (2026-06-11) — Security 5/5, Architecture 3/5, Testing 2/5
Most Architecture/Testing "critical gaps" were the **plan not being executed yet** (rename not done, `analysis.md` not drafted, `/initialize` not yet updated, `_status.json` lacks the key) — a category error for a pre-execution plan review. Added the **execution-ordering note** clarifying single-PR order + that Verification gates are post-execution. Genuine points folded in:
- `## Promoted Analyses` create-if-absent + dedupe-on-rerun; `/analysis` treats missing `analyses` key as `[]` and initializes on first write.
- **Correction:** `/finalize` doesn't read `_status.json` at all → field is even safer than originally claimed (schema-delta reworded).
- Dangling-link grep reworded as an execution-time manual gate (not a permanent `/finalize` feature; permanent CI link-check is an accepted out-of-scope tradeoff).

### Iteration 3 (2026-06-11) — Security 5/5, Architecture 5/5, Testing 5/5 → ✅ CONSENSUS
All reviewers voted 5/5 with zero critical gaps after the framing was corrected (pre-execution plan; don't penalize unbuilt work) and the genuine idempotency/finalize/ordering points were folded in. Only nit: specify `## Promoted Analyses` placement → resolved (appended at end of file). **Plan is ready for execution.**
