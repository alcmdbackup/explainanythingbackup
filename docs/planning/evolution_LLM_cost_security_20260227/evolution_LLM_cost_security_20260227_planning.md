# Evolution LLM Cost Security Plan

## Background
Ensure that no bugs or compromised API keys can ever allow LLM spending beyond a pre-specified limit. Implement multiple levels of safeguards spanning provider-level hard caps, application-level global caps, per-run budget hardening, and monitoring/alerting to create defense-in-depth cost protection for the evolution pipeline and all LLM usage.

## Requirements (from GH Issue #TBD)

### L1 - Provider-Level Hard Caps
- Set spending limits directly at OpenAI/DeepSeek/Anthropic dashboards as ultimate backstop
- No application code can bypass these limits — even fully compromised keys are capped
- Document the current provider limit settings and recommended values

### L2 - Application Global Caps
- Daily + monthly aggregate spending limits tracked in the database
- Global kill switch that halts ALL LLM calls system-wide
- Separate caps for evolution vs non-evolution LLM usage
- Configurable limits via admin UI or environment variables

### L3 - Per-Run Caps (hardening existing infrastructure)
- Existing CostTracker per-run budget enforcement (already implemented)
- Add: max concurrent runs cap to prevent runaway parallel spending
- Add: per-batch total budget enforcement
- Add: auto-pause when global daily cap is approached

### L4 - Monitoring & Alerting
- Honeycomb/observability alerts at 50%/80%/95% of daily cap
- Anomaly detection for unusual per-minute spend rates
- Slack/email notifications when thresholds are breached

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Add global cap and kill switch documentation
- `evolution/docs/evolution/reference.md` - Update config, env vars, and budget enforcement sections
- `evolution/docs/evolution/architecture.md` - Document new global budget check in pipeline flow
- `evolution/docs/evolution/data_model.md` - Document new tables for global spending tracking
- `evolution/docs/evolution/strategy_experiments.md` - Document experiment budget guardrails
- `evolution/docs/evolution/visualization.md` - Document new cost monitoring dashboard elements
- `evolution/docs/evolution/README.md` - Update overview with cost security features
