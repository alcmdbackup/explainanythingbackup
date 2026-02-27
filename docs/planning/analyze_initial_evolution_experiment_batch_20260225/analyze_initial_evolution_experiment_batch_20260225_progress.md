# Analyze Initial Evolution Experiment Batch Progress

## Phase 1: Analysis Script & Tests (COMPLETE)
### Work Done
- Created `evolution/scripts/analyze-experiments.ts` — comprehensive analysis script covering 8 dimensions:
  1. Run Overview (completion rate, costs, durations, stop reasons)
  2. Strategy Comparison (sorted by elo_per_dollar)
  3. Agent ROI (per-agent cost and elo_gain)
  4. Cost Estimation Accuracy (predicted vs actual)
  5. Automated Experiments (round-level analysis)
  6. Hall of Fame Cross-Method Comparison (evolution vs oneshot)
  7. Convergence Patterns (iterations to plateau, baseline rank displacement)
  8. Follow-Up Recommendations
- Created `evolution/scripts/analyze-experiments.test.ts` — 31 unit tests, all passing
- Exported pure helper functions for testability without DB access

### Issues Encountered
- `import.meta.url` incompatible with Jest CJS transform → replaced with `process.cwd()`
- `main()` running as module side-effect during import → guarded with `NODE_ENV !== 'test'` check
- No `.env.local` in worktree → script must be run from worktree with DB access

### User Clarifications
- None needed

## Phase 2: Run Analysis Against Database (COMPLETE)

### 2a: Dev Database Analysis
- Ran `npx tsx evolution/scripts/analyze-experiments.ts` against Supabase staging DB
- Full output saved to `analysis_output_raw.txt` (131KB)

#### Dev Key Metrics
- **71 total runs**: 24 completed (33.8%), 43 failed (60.6%), 4 other
- **Total cost**: $0.73 across all runs, avg $0.03/run
- **Elo range**: 1200-1584, avg 1255, stddev 145
- **210 strategy configs** — but ~170 are single-run `test_strategy_*` artifacts
- **Agent ROI**: generation (307 Elo/$) > iterativeEditing (206 Elo/$)
- **HoF**: 118 entries — oneshot (1382 avg Elo) outperforms evolution_winner (1303 avg Elo)
- **Data quality**: Heavily polluted with test artifacts, sparse agent metrics, no cost estimates

#### Dev Issues
- Sandbox `fetch failed` even with `*.supabase.co` whitelisted → `dangerouslyDisableSandbox: true`
- npm cache on read-only filesystem → `npm_config_cache=/tmp/claude-1000/npm-cache`

### 2b: Production Database Analysis
- Queried production via `scripts/query-prod.ts` using `readonly_local` role over session pooler
- Connection: `postgresql://readonly_local.qbxhivoezkfbjbsctdzo:***@aws-1-us-east-2.pooler.supabase.com:5432/postgres`
- Full output saved to `analysis_output_prod.txt`

#### Production Key Metrics
- **34 total runs**: 13 completed (38.2%), 17 failed (50.0%), 4 paused (11.8%)
- **Total cost**: $1.79 ($1.40 completed, $0.36 failed, $0.02 paused)
- **Avg cost (completed)**: $0.108/run, range $0.047-$0.152
- **Avg duration (completed)**: 25.0 min, range 11.6-47.1 min
- **7 strategy configs** — all real, no test artifacts
- **Pipeline types**: 22 full, 12 unknown (pre-pipeline_type tracking)

#### Production Strategy Ranking (by Elo/$)
| Strategy | Gen Model | Judge Model | Iters | Runs | Avg Elo | Elo/$ |
|----------|-----------|-------------|-------|------|---------|-------|
| Quality | deepseek-chat | deepseek-chat | 5 | 1 | 1677 | 3502 |
| d912bd | gpt-5-mini | gpt-5-mini | 3 | 2 | 745 | -1538 |
| 72b29a | claude-sonnet-4 | gpt-5-mini | 3 | 2 | 781 | -1665 |
| 78b5dc | gpt-5-nano | gpt-5-mini | 3 | 2 | 667 | -1959 |
| 26d69e | deepseek-chat | gpt-5-mini | 3 | 2 | 681 | -2153 |
| 0ab991 | gpt-5-nano | gpt-5-nano | 3 | 2 | 744 | -4147 |
| ddf6d9 | gpt-5-mini | gpt-5-nano | 3 | 2 | 701 | -5222 |

#### Production Agent ROI
| Agent | Samples | Avg Elo Gain | Elo/$ |
|-------|---------|-------------|-------|
| generation | 12 | 55 | 30,757 |
| debate | 1 | 110 | 27,089 |
| iterativeEditing | 12 | 150 | 12,900 |
| evolution | 1 | 29 | 9,601 |

#### Production Experiments
- **"Initial experiment"**: $1.00 budget, spent $0.77. L8 screening (8/8 runs). Best Elo: 1546. Judge Model had largest effect (-63 Elo). Budget exhausted in Round 1.
- **"Test"**: $0.50 budget, spent $0.51. L8 screening (4/8 runs). Best Elo: 1562. Generation Model had largest effect (+86 Elo). Budget exhausted in Round 1. WARNING: partial data.

#### Production HoF
- 16 entries total, all evolution (8 evolution_winner at 1477 avg Elo, 8 evolution_top3 at 1487 avg Elo)
- No oneshot baseline in production — cannot compare methods

#### Production Convergence
- Top ordinal range: 8.4-29.8 (Elo ~1335-1677)
- Baseline rank range: 8-16 (avg 12.8, out of ~20 variants)
- The single 5-iteration run (Quality/deepseek) dramatically outperformed all 3-iteration runs

#### Key Production Findings
1. **deepseek-chat dominates**: Only strategy with positive Elo/$ (3502). All others below baseline.
2. **More iterations help**: 5-iter run (29.8 ordinal) >> 3-iter runs (8.4-22.6 ordinal)
3. **50% failure rate**: Watchdog timeouts, batch runner incompatibilities
4. **Budget too low**: Both experiments exhausted in Round 1 at $0.10/run
5. **No oneshot baseline in prod HoF**: Can't compare evolution vs oneshot
6. **iterativeEditing is the workhorse**: 150 Elo gain avg, 12 samples, most expensive per-agent
7. **Contradictory experiment results**: "Initial" says Judge Model matters most, "Test" says Generation Model matters most — different factor levels + partial data

#### Production Connection Issues Encountered
- Direct connection (`db.*.supabase.co`) is IPv6-only — unreachable from this network
- Supabase pooler hostname is region-specific — `aws-1-us-east-2` not `aws-0-us-west-1`
- `readonly_local` role works via session pooler (port 5432), NOT transaction pooler (port 6543)

### User Clarifications
- User provided correct session pooler hostname from Supabase dashboard
- User confirmed `readonly_local` role exists in production via SQL query

## Phase 3: Document Findings (COMPLETE)
### Work Done
- Saved production analysis output to `analysis_output_prod.txt`
- Updated research doc `Key Findings` section with 10 findings derived from production data
- Updated research doc `Open Questions` section with 5 targeted questions for follow-up
- Findings organized into 3 categories: Model & Strategy Performance, Experiment Infrastructure, Agent & Cost Analysis
- Compared dev vs production data: production is much cleaner (no test artifacts) but smaller (34 vs 71 runs)

### Issues Encountered
- `results_summary` and `analysis_results` JSONB columns render as `[object Object]` in table mode — had to re-run with `--json` flag
- Dev data heavily polluted with test artifacts; production data is the primary source of truth

### User Clarifications
- None needed

## Phase 4: Follow-up Experiment Design
### Work Done
[Pending — depends on Phase 3 findings]

### Issues Encountered
[Pending]

### User Clarifications
[Pending]

## Phase 5: Documentation & PR
### Work Done
[Pending]

### Issues Encountered
[Pending]

### User Clarifications
[Pending]
