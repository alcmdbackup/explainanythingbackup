# LLM Provider Spending Limits

Ultimate backstop — provider-level limits cannot be bypassed by any application bug or compromised key.

## Current Providers

Models verified against `src/config/modelRegistry.ts` on 2026-06-22.

| Provider | Dashboard | Models Used |
|----------|-----------|-------------|
| OpenAI | [platform.openai.com/settings/limits](https://platform.openai.com/settings/limits) | gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano, o3-mini |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | deepseek-chat, deepseek-v4-pro, deepseek-v4-flash (Pattern A-1 E2E + nightly smoke test model — see `evolution/docs/cost_optimization.md`) |
| Anthropic | [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits) | claude-sonnet-4-20250514 |
| OpenRouter | [openrouter.ai/activity](https://openrouter.ai/activity) | openai/gpt-oss-20b, google/gemini-2.5-flash (`supportsJsonSchema` → schema-enforced structured output), google/gemini-2.5-flash-lite, qwen/qwen3-8b, qwen/qwen-2.5-7b-instruct |
| Local (Ollama) | N/A (self-hosted on minicomputer) | LOCAL_qwen2.5:14b |

## Recommended Monthly Limits

| Provider | Recommended Limit | Rationale |
|----------|-------------------|-----------|
| OpenAI | $200/month | Covers non-evolution calls + buffer |
| DeepSeek | $100/month | Primary evolution model, cheap per-call |
| Anthropic | $100/month | Low-volume usage for specific tasks |
| OpenRouter | $50/month | GPT-OSS-20B only, very cheap per-call |
| Local (Ollama) | $0/month | Self-hosted, no API costs |

## Update Procedure

1. Log into provider dashboard with team credentials
2. Navigate to billing/limits settings
3. Set monthly hard cap to recommended value
4. Verify email alerts are configured at 50% and 80% of limit
5. Document changes in this file with date

## Escalation When Limits Hit

1. Provider blocks API calls with 429 status
2. Application logs will show LLM_API_ERROR in Sentry
3. Check admin dashboard at `/admin/costs` for current spend
4. If legitimate usage: increase provider limit temporarily
5. If suspicious: verify kill switch is enabled, investigate source

## Application-Level Caps (Defense-in-Depth)

Provider limits are the outer layer. The application also enforces:
- **Daily cap**: $50/day (configurable via admin UI; verified in staging `llm_cost_config.daily_cap_usd` 2026-06-22)
- **Monthly cap**: $500/month (configurable via admin UI; verified in staging `llm_cost_config.monthly_cap_usd` 2026-06-22)
- **Evolution daily cap**: $25/day (configurable via admin UI; verified in staging `llm_cost_config.evolution_daily_cap_usd` 2026-06-22)
- **Kill switch**: Instantly blocks all LLM calls (default off)
- **Concurrent run limit**: Max 5 simultaneous evolution runs
- **Test-bucket alarm**: daily GitHub Actions cron at 18:00 UTC; soft warn $0.05/24h, hard alarm $0.10/24h — files `[release-health]` issue + Slack on hard alarm. See `.github/workflows/evolution-cost-alarm.yml`.

See `/admin/costs` for real-time spending dashboard and controls.

## Audit Cadence

- **App-level caps** (`llm_cost_config` table): run `npx tsx evolution/scripts/auditLlmCostConfig.ts` from a clean checkout with staging env. Compare against the recommended values above.
- **Provider-level caps** (monthly hard caps on each provider dashboard): manual quarterly check — log into each dashboard, verify cap matches the table above, confirm 50%/80% email alerts are enabled.
- **Last audit**: 2026-06-22 (Phase 4 of `reduce_e2e_testing_llm_costs_20260621`) — staging app caps match docs; provider dashboards require manual verification.
