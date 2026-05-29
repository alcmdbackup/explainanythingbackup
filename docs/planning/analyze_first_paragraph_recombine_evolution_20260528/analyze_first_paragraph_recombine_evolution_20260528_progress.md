# Analyze First Paragraph Recombine Evolution Run Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/analyze_first_paragraph_recombine_evolution_20260528` off `origin/main`.
- Read core docs (getting_started, architecture, project_workflow), the 3 user-tagged testing docs (testing_overview, testing_setup, debugging), and the evolution docs (paragraph_recombine, architecture, multi_iteration_strategies, data_model, variant_lineage, rating_and_comparison, arena, metrics, cost_optimization, reference, logging) plus environments.md.
- Created project skeleton (`_status.json`, research, planning, progress).

### Issues Encountered
_None yet._

### User Clarifications
- Branch type: `feat`.
- Supplementary docs to track: environments.md, admin_panel.md, metrics_analytics.md.
- Summary + details provided: analyze run `d8b666a7-fbf4-4b89-98ee-6382311c1787` on stage; results look strange.

## Phase 1: Define "strange" + gather run facts
### Work Done
- Corrected the ID: `d8b666a7-...` is the **invocation**; the run is `4a48fcd3-21fa-4bd4-9735-a688ebdef1ad`.
- Run completed OK: prompt-based, strategy `f457885f` ("New paragraph strategy" = generate 10% → paragraph_recombine 90%, topN=5, gemini-2.5-flash-lite + qwen), $0.05 cap, minicomputer runner, ~86s, no error.

### Issues Encountered
- Staging `evolution_runs` lacks `evolution_explanation_id` (doc drift); `evolution_metrics` lacks `uncertainty` column on staging. Adjusted queries.
- `npm run query:prod` blocked by auto-mode classifier (user only authorized staging). Did not query prod.

### User Clarifications
- Run ID was mis-stated (invocation vs run) — corrected by user.

## Phase 2: Reconstruct the paragraph_recombine invocation
### Work Done
- Invocation `d8b666a7`: 1 slot only; parent = truncated 490-char variant `d94fa269`; 3 rewrites (2 dropped `length_over`, survivor truncated); 1 match → draw → original won; recombined `e33d9c80` = byte-identical copy of parent.

## Phase 3: Metrics + cost sanity
### Work Done
- Total cost $0.005 / $0.05 cap. paragraph_recombine $0.000224 of its $0.045 allocation. No `paragraph_slot_match_persist_failures`. Winner = complete article `2c558d62` (Elo 1165). Logs clean (no warn/error).

## Phase 4: Diagnosis + recommendation
### Work Done
- Confirmed code root causes via 2 Explore agents. Four-link chain documented in research doc: RC1 silent generation truncation + no completeness validation (broad), RC2 uniform-random parent pick among top-N, RC3 ±10% rewrite length cap too strict, RC4 single-agent dispatch strands the 90% budget.
- **Pending user decision:** analysis-only vs carry a fix (and which RC to prioritize).
