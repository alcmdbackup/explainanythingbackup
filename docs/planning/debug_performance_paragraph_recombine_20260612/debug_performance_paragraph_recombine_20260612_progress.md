// Progress tracker for debug_performance_paragraph_recombine_20260612.

# Progress

## Phase 1 — Research
- [x] 4-round × 5-agent investigation (preserved at ~/Documents/ac/option_b_reference_20260614/planning/).
- [x] Quantitative baseline + R2A reference case captured in research doc.

## Phase 2 — Planning
- [x] Greenfield Sequential Context-Aware Generation plan written.
- [ ] Plan review iteration (5/5 consensus target).

## Phase A — Coordinator
- [ ] A.1 coordinator.ts
- [ ] A.2 buildCoordinatorPrompt.ts
- [ ] A.3 Zod schemas
- [ ] A.4 AgentName + COST_METRIC_BY_AGENT entry

## Phase B — Sequential per-paragraph round
- [ ] B.1 buildSequentialRewritePrompt.ts
- [ ] B.2 promptSafety.ts
- [ ] B.3 ParagraphRecombineAgent.execute() rewrite
- [ ] B.4 env flag wiring
- [ ] B.5 low-cap allowlist guard

## Phase C — Emit + article-level rank
- [ ] C.1 Verify Phase C reuses existing assemble + format + rank without change

## Cost-tracking
- [ ] Cost rollup (3-phase sum) wired
- [ ] Projector extended

## Metrics
- [ ] Registry + extractor + entity propagation + unit tests (4 layers per new metric)

## Documentation
- [ ] paragraph_recombine.md / cost_optimization.md / metrics.md / architecture.md / reference.md

## Validation
- [ ] G.1 pre-merge checks
- [ ] G.2 local R2A run
- [ ] G.3 7-day canary
- [ ] G.4 14-day decision gate
