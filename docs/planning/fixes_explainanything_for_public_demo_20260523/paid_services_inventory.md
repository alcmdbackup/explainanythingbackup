# Paid Services Inventory — Pre-Demo Top-Up Checklist

Phase 8 of `fixes_explainanything_for_public_demo_20260523`.

Sourced from R2E Explore agent findings (see `_research.md`). Audit every external service we pay for so we know what to top up before the demo and which quotas to watch.

## Service Inventory

| Service | Purpose | Env var | Billing | Demo concern | Action |
|---|---|---|---|---|---|
| **OpenAI** | LLM (GPT-4.1, GPT-4o, etc.) + embeddings | `OPENAI_API_KEY` | Per-token ($0.10–$60 per 1M tokens depending on model) | **HIGH** — primary cost driver | **Top up to $100+** before demo. Verify Honeycomb shows expected usage rate. |
| **Anthropic** | Claude Sonnet 4 (optional path) | `ANTHROPIC_API_KEY` | Per-token ($3 in / $15 out per 1M) | Medium — only if AI editor uses Claude | Top up if used in the demo flow; otherwise skip. |
| **DeepSeek** | LLM fallback | `DEEPSEEK_API_KEY` | Per-token ($0.28 in / $0.42 out per 1M) | Low — cheap | Verify key still valid; minimal top-up. |
| **OpenRouter** | Qwen / Gemini / gpt-oss gateway | `OPENROUTER_API_KEY` | Per-token | Low | Skip unless explicitly used. |
| **Pinecone** | Vector DB (embeddings storage + search) | `PINECONE_API_KEY` | Per-month + per-op (~$0.70/M vectors/month after free tier) | Medium — every save creates a vector | Verify storage quota on `explainanythingprodlarge` index. |
| **Supabase** | Postgres DB + Auth | `SUPABASE_SERVICE_ROLE_KEY` | Freemium (free tier sufficient for demo) | Low | No action. |
| **Honeycomb** | Distributed tracing + logs (OTEL) | `OTEL_EXPORTER_OTLP_HEADERS` | Freemium (20M events/month free, then $0.40/M) | **MEDIUM** — `OTEL_SEND_ALL_LOG_LEVELS=true` can burn the quota fast | **Set `OTEL_SEND_ALL_LOG_LEVELS=false`** in Vercel Production env vars before demo. |
| **Sentry** | Error tracking + perf monitoring | `SENTRY_DSN` | Freemium (5K errors/month free) | Medium — verify quota | Check Sentry dashboard quota usage; bump plan if close to limit. |
| **Resend** | Email (maintenance scheduler only) | `RESEND_API_KEY` | Per-message | Not on demo path | No action. |
| **Vercel** | Hosting (functions + bandwidth) | (managed by Vercel) | Per-bandwidth + per-function | Low | Demo within free tier. |

## Pre-Demo Action Checklist

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Top up OpenAI to ≥ $100 | | pending |
| 2 | Verify Anthropic balance (if Claude is in the demo path) | | pending |
| 3 | Set `OTEL_SEND_ALL_LOG_LEVELS=false` in Vercel Production env vars | | pending |
| 4 | Check Sentry monthly error quota usage; bump plan if > 80% | | pending |
| 5 | Check Honeycomb monthly event quota; bump plan if > 80% | | pending |
| 6 | Verify Pinecone `explainanythingprodlarge` index storage room (room for ≥ 100 new vectors from demo saves) | | pending |
| 7 | Confirm Vercel Production deployment protection is configured (bypass token if demo traffic isn't from authenticated users) | | pending |

## Recurring monthly checks (post-demo)

These aren't blocking the demo, but worth establishing as a habit:
- Monthly OpenAI usage report → adjust top-up cadence
- Monthly Honeycomb event count → consider sampling adjustments if approaching cap
- Monthly Pinecone storage growth → plan archive of old/test vectors

## Notes

- The **guest's $10/day per-user LLM cap** (per Phase 4) is the inner-ring defense against a single rogue demo viewer hammering "regenerate" and burning the global budget. The global non-evolution daily cap ($50) is the outer ring. Both are enforced by `LlmSpendingGate`.
- If demo budget runs out mid-event, the kill switch (`llm_cost_config.kill_switch_enabled = true`) is the emergency stop.
