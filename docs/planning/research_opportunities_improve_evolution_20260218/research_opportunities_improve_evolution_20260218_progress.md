# Research Opportunities Improve Evolution Progress

## Phase 1: Codebase Audit (Complete — 2026-02-18)
### Work Done
- Audited all 12 agents, core infrastructure, cost tracking, model routing, strategy experiments
- Documented current cost structure, budget caps, model pricing, agent execution order
- Identified 6 key findings: model cost asymmetry, tournament as largest cost center, unwired adaptive allocation, missing strategy CLI, sequential dispatch bottleneck, pseudo-embeddings

### Issues Encountered
- None — straightforward audit

## Phase 2: Deep Analysis & Recommendations (Complete — 2026-02-19)
### Work Done
- Ran 5 parallel deep-dive investigations:
  1. **Tournament cost reduction** — Found 11 specific opportunities including convergence streak reduction (5→2), tiebreaker threshold fix, flow budget guard, single-pass for high-gap pairs
  2. **Agent parallelism** — Mapped complete state dependency graph for all 12 agents. Identified 6-stage parallel dispatch model giving 3-4x wall-clock speedup
  3. **Caching & format validation** — Found cross-run cache is architecturally ready but low-benefit without variant seeding. Found format auto-fix could recover 30-50% of rejected variants
  4. **Algorithmic improvements** — Found 8 specific improvements: pseudo-embedding fix (CRITICAL), diverse parent selection, self-eval pre-filter, pool culling, strategy arm weights, multi-objective Pareto, lineage enforcement, ML surrogate
  5. **Web literature** — Surveyed LLM-as-judge efficiency, tournament design, evolutionary text optimization, surrogate-assisted evolution, prompt caching techniques

### Key Findings
- **Pseudo-embeddings are the #1 algorithmic issue** — breaks all diversity logic, causes premature convergence and false degenerate stops
- **Staged parallel dispatch is the #1 technical issue** — 3-4x wall-clock improvement with safe JS cooperative concurrency
- **Tournament convergence streak of 5 is wasteful** — sigma is monotonically decreasing, streak 2 is sufficient
- **Estimated aggregate impact of Tier 1 improvements:** ~32% budget savings, ~60-75% wall-clock reduction, 15-25% quality improvement

### Deliverables
- 20 prioritized recommendations in `_research.md` Phase 2 section
- Phased execution plan in `_planning.md` (4 phases, ordered by effort/impact)
- Concrete code change locations and proposed implementations for each item

## Phase 3: Implementation
### Status: Not started — awaiting approval of execution plan
