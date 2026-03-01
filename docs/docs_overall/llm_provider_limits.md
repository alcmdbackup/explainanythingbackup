# LLM Provider Spending Limits

Ultimate backstop — provider-level limits cannot be bypassed by any application bug or compromised key.

## Current Providers

| Provider | Dashboard | Models Used |
|----------|-----------|-------------|
| OpenAI | [platform.openai.com/settings/limits](https://platform.openai.com/settings/limits) | gpt-4.1-mini, gpt-4.1-nano |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | deepseek-chat |
| Anthropic | [console.anthropic.com/settings/limits](https://console.anthropic.com/settings/limits) | claude-3.5-sonnet, claude-3.5-haiku |

## Recommended Monthly Limits

| Provider | Recommended Limit | Rationale |
|----------|-------------------|-----------|
| OpenAI | $200/month | Covers non-evolution calls + buffer |
| DeepSeek | $100/month | Primary evolution model, cheap per-call |
| Anthropic | $100/month | Low-volume usage for specific tasks |

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
- **Daily cap**: $50/day (configurable via admin UI)
- **Monthly cap**: $500/month (configurable via admin UI)
- **Evolution daily cap**: $25/day (configurable via admin UI)
- **Kill switch**: Instantly blocks all LLM calls
- **Concurrent run limit**: Max 5 simultaneous evolution runs

See `/admin/costs` for real-time spending dashboard and controls.
