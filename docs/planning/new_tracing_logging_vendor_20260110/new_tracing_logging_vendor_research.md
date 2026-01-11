# New Tracing Logging Vendor Research

---
date: 2026-01-10T07:06:27-08:00
researcher: Claude
git_commit: 34742f84ab5a54087a568a60afd174e56ca2632b
branch: git_and_workflow_improvements
repository: explainanything
topic: "Finding a Grafana alternative for tracing and logging"
tags: [research, observability, tracing, logging, grafana, opentelemetry, vendor-evaluation]
status: complete
last_updated: 2026-01-10
last_updated_by: Claude
pricing_research_date: 2026-01-10
decision: Honeycomb
decision_date: 2026-01-10
---

## 🎯 DECISION: Honeycomb

**Chosen Vendor:** Honeycomb
**Decision Date:** 2026-01-10
**Rationale:** Best combination of 60-day retention, unlimited users, graceful degradation, and strong OTLP support. See [Final Decision](#final-decision) section for details.

---

## Problem Statement

Grafana is difficult to set up and use. The goal is to find a cheap (preferably free) vendor who can support traces and store logs (all levels, not just error/warn) for later retrieval for debugging purposes. The new vendor should plug into the existing infrastructure built around Grafana, essentially swapping in as a replacement.

## High Level Summary

The codebase has a **production-grade observability stack** using:
- **OpenTelemetry (OTLP)** for distributed tracing and structured logging
- **Grafana Cloud** (Tempo for traces, Loki for logs) as the backend
- **Sentry** for error tracking and session replay

**Key Finding:** The infrastructure is OTLP-native, meaning any vendor supporting OpenTelemetry can be swapped in with minimal code changes—just update environment variables.

**Top Vendor Recommendations (Updated Jan 2026):**
1. **Grafana Cloud** - **BEST FREE TIER**: 150 GB free (50 logs + 50 traces + 50 profiles), 14-day retention, 3 users, full alerting
2. **New Relic** - 100 GB/month free, 8-day retention, full platform
3. **Honeycomb** - 20M events free, 60-day retention, unlimited users
4. **OpenObserve** (self-host) - Simplest setup, ~$3/month on Hetzner VPS

**✅ Good news:** Production-viable free cloud tiers DO exist. Grafana Cloud, New Relic, and Honeycomb all offer generous free tiers with team collaboration and proper alerting.

**⚠️ Avoid:** Axiom Personal - "500 GB free" hides severe limits (2 datasets, 1 user, 3 monitors, no Slack/PagerDuty).

---

## Current Infrastructure Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER                                       │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ Console Logs     │     │ Browser Traces   │                      │
│  │ (intercepted)    │     │ (WebTracerProvider)                     │
│  └────────┬─────────┘     └────────┬─────────┘                      │
│           │ localStorage           │ BatchSpanProcessor              │
│           ▼                        ▼                                 │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ Remote Flusher   │     │ OTLP Exporter    │                      │
│  │ (30s batches)    │     │                  │                      │
│  └────────┬─────────┘     └────────┬─────────┘                      │
└───────────┼────────────────────────┼────────────────────────────────┘
            │                        │
            ▼                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                        SERVER                                      │
│  ┌──────────────────┐     ┌──────────────────┐                    │
│  │ /api/client-logs │     │ /api/traces      │  (CORS proxies)    │
│  └────────┬─────────┘     └────────┬─────────┘                    │
│           │                        │                               │
│           ▼                        ▼                               │
│  ┌──────────────────────────────────────────┐                     │
│  │         OpenTelemetry SDK                 │                     │
│  │  - BatchLogRecordProcessor                │                     │
│  │  - Auto-instrumentation (Node.js)         │                     │
│  │  - Custom tracers (LLM, DB, Vector, App)  │                     │
│  └────────────────────┬─────────────────────┘                     │
│                       │                                            │
│  ┌────────────────────┼────────────────────┐                      │
│  │ OTLP HTTP Exporter │                    │                      │
│  └────────────────────┼────────────────────┘                      │
└───────────────────────┼────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────┐
│              GRAFANA CLOUD (Current Backend)                       │
│  ┌─────────────────┐     ┌─────────────────┐                      │
│  │ Tempo (Traces)  │     │ Loki (Logs)     │                      │
│  │ /v1/traces      │     │ /v1/logs        │                      │
│  └─────────────────┘     └─────────────────┘                      │
└───────────────────────────────────────────────────────────────────┘
```

### Key Configuration Files

| File | Purpose |
|------|---------|
| `instrumentation.ts` | Server-side tracing setup, custom tracers |
| `src/lib/tracing/browserTracing.ts` | Browser-side WebTracerProvider |
| `src/lib/logging/server/otelLogger.ts` | OTLP log exporter to Grafana |
| `src/lib/logging/client/consoleInterceptor.ts` | Browser console interception |
| `src/lib/logging/client/remoteFlusher.ts` | Batched log shipping to server |
| `src/app/api/traces/route.ts` | CORS proxy for browser→Grafana traces |
| `src/app/api/client-logs/route.ts` | Client log ingestion endpoint |
| `sentry.server.config.ts` | Sentry server-side initialization |
| `sentry.client.config.ts` | Sentry client-side with session replay |

### Environment Variables (What to Change)

```bash
# Current Grafana Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64-token>"

# Browser-side (for /api/traces proxy)
NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp
NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=<token>
```

**To swap vendors:** Only these 4 environment variables need to change.

---

## Integrations and Data Formats

### Protocol Support

| Protocol | Used For | Location |
|----------|----------|----------|
| OTLP/HTTP | Traces & Logs export | All exporters |
| Protobuf | Binary trace encoding | `/api/traces` proxy |
| JSON | Alternative trace encoding | Fallback |
| W3C Traceparent | Distributed trace context | `fetchWithTracing.ts` |

### OpenTelemetry Packages

```json
{
  "@opentelemetry/api": "^1.9.0",
  "@opentelemetry/api-logs": "^0.208.0",
  "@opentelemetry/auto-instrumentations-node": "^0.67.3",
  "@opentelemetry/exporter-logs-otlp-http": "^0.208.0",
  "@opentelemetry/exporter-trace-otlp-http": "^0.208.0",
  "@opentelemetry/sdk-logs": "^0.208.0",
  "@opentelemetry/sdk-trace-base": "^2.2.0",
  "@opentelemetry/sdk-trace-web": "^2.2.0"
}
```

### Sentry Integration

- **SDK:** `@sentry/nextjs ^10.32.1`
- **Tracing:** 20% sample rate (prod), 100% (dev)
- **Session Replay:** 10% all sessions, 100% on errors
- **Tunnel:** `/api/monitoring` bypasses ad blockers

**Note:** Sentry is separate from the tracing/logging infrastructure. It handles error tracking and session replay. The vendor swap only affects the OTLP backend.

---

## Where Traces and Logs Are Sent From

### Server-Side Sources

| Component | Type | File |
|-----------|------|------|
| Auto-instrumented Node.js | Traces | `package.json` (NODE_OPTIONS) |
| Pinecone API calls | Traces | `instrumentation.ts:48-72` |
| Supabase API calls | Traces | `instrumentation.ts:73-96` |
| LLM operations | Traces | `createLLMSpan()` |
| Database operations | Traces | `createDBSpan()` |
| Vector operations | Traces | `createVectorSpan()` |
| Application spans | Traces | `createAppSpan()` |
| `emitLog()` calls | Logs | `otelLogger.ts` |
| `logger.*()` calls | Logs | `server_utilities.ts` |

### Client-Side Sources

| Component | Type | File |
|-----------|------|------|
| `console.log/info/warn/error` | Logs | `consoleInterceptor.ts` |
| `fetchWithTracing()` calls | Traces | `fetchWithTracing.ts` |
| Pre-hydration logs | Logs | `earlyLogger.ts` |
| Uncaught errors | Logs | `consoleInterceptor.ts:194-203` |
| Unhandled rejections | Logs | `consoleInterceptor.ts:206-214` |

### Log Level Policy

| Environment | Levels Sent | Control Variable |
|-------------|-------------|------------------|
| Production (default) | ERROR, WARN only | - |
| Production (override) | All levels | `OTEL_SEND_ALL_LOG_LEVELS=true` |
| Development/Staging | All levels | Always |

**Important:** To send all log levels in production, set `OTEL_SEND_ALL_LOG_LEVELS=true` (runtime) or `NEXT_PUBLIC_LOG_ALL_LEVELS=true` (build-time for client).

---

## Vendor Alternatives Comparison

### Summary Table (Updated Jan 2026)

| Vendor | Free Tier | Paid Pricing | OTLP Native | Best For |
|--------|-----------|--------------|-------------|----------|
| **Grafana Cloud** | 150 GB (50 logs+50 traces+50 profiles) | Usage-based | ✅ Yes | **BEST FREE TIER** |
| **New Relic** | 100 GB/month | Usage-based | ✅ Yes | Large free allowance |
| **Honeycomb** | 20M events/mo, 60-day retention | Usage-based | ✅ Yes | Best retention |
| **Uptrace** | 1.2 TB trial | $0.08/GB | ✅ Yes | Best paid value |
| **OpenObserve** | Unlimited (self-host) | Cloud TBD | ✅ Yes | Simplest self-host |
| **CubeAPM** | None | $0.15/GB all-in | ✅ Yes | Cheapest SaaS |
| **HyperDX** | 3 GB/month | $20/mo flat (50 GB) | ✅ Yes | Simple pricing |
| **SigNoz** | Unlimited (self-host) | $49/mo + $0.30/GB | ✅ Yes | Full control |
| **Axiom Personal** | 500 GB (but 2 datasets, 1 user) | $25/mo Cloud | ✅ Yes | ⚠️ Severe limits |

### Best Free Cloud Tiers (Production-Viable)

| Vendor | Free Storage | Retention | Users | Monitors | Alerts To |
|--------|--------------|-----------|-------|----------|-----------|
| **Grafana Cloud** | 150 GB total | 14 days | 3 active | Generous | Slack, PagerDuty, etc |
| **New Relic** | 100 GB/month | 8 days | 1 full + unlimited basic | Yes | Multiple channels |
| **Honeycomb** | 20M events | 60 days | Unlimited | Yes | Multiple channels |
| **Axiom Personal** | 500 GB | 30 days | ❌ 1 only | ❌ 3 only | ❌ Email/Discord only |

**Winner: Grafana Cloud** - Best combination of storage, retention, users, and alerting integrations.

### Small Team Cost Comparison (2-5 devs, 10-50 GB/month)

| Vendor | 10 GB/mo | 30 GB/mo | 50 GB/mo | Notes |
|--------|----------|----------|----------|-------|
| **Grafana Cloud** | $0 | $0 | $0 | Within 150 GB free |
| **New Relic** | $0 | $0 | $0 | Within 100 GB free |
| **Honeycomb** | $0 | $0 | $0 | Within 20M events |
| **OpenObserve (self-host)** | ~$3 | ~$3 | ~$3 | Hetzner CX23 |
| **Uptrace (self-host)** | ~$6 | ~$6 | ~$6 | Hetzner CX33 |
| **SigNoz (self-host)** | ~$6 | ~$6 | ~$6 | Hetzner CX33 |
| **CubeAPM** | $1.50 | $4.50 | $7.50 | No hidden fees |
| **Uptrace Cloud** | $1 | $2.40 | $4 | After trial |
| **HyperDX** | $20 | $20 | $20 | Flat fee covers 50 GB |
| **Axiom Cloud** | $25-27 | $28-30 | $32-35 | Base + usage |
| **SigNoz Cloud** | $52 | $58 | $64 | $49 base + $0.30/GB |
| **Better Stack** | $108 | $183 | $212-239 | Per-user fees add up |

### Detailed Vendor Analysis

#### 0. Grafana Cloud (BEST FREE TIER - RECOMMENDED)

**Free Tier (Forever Free):**
- 50 GB Logs + 50 GB Traces + 50 GB Profiles = **150 GB total**
- 10,000 Prometheus metric series
- 14-day retention on all data
- 3 active visualization users (+ unlimited read-only)
- Alerting to Slack, PagerDuty, webhooks, etc.

**Why This is #1 Recommendation:**
- Most generous production-viable free tier
- Full alerting integrations (not just Email/Discord)
- 3 users can collaborate (not single-user like Axiom)
- 14-day retention (vs 8 days New Relic)
- Native OTLP support
- Already familiar if you've used Grafana OSS

**Gotchas:**
- Limited to 10k metric series (cardinality limit, not data volume)
- Only 3 "active" users (viewers are unlimited)
- Need to stay within 50 GB per signal type

**Startup Program:** Up to $100,000 credits for 12 months (if <$10M funding, <25 employees)

**Links:**
- [Pricing](https://grafana.com/pricing/)
- [Free Tier Details](https://grafana.com/products/cloud/)

---

#### 0b. New Relic (Largest Free Data Allowance)

##### Company Profile

| Attribute | Details |
|-----------|---------|
| **Founded** | 2008 by Lew Cirne (name is anagram of his name) |
| **Status** | Private (acquired Nov 2023 for $6.5B by Francisco Partners + TPG) |
| **Previous** | Public NYSE:NEWR from 2014-2023 |
| **Employees** | ~2,000-3,000 |
| **Revenue** | ~$960M/year |
| **HQ** | San Francisco, CA |

**Recent News:**
- Nov 2023: Acquired by private equity for $6.5B, delisted from NYSE
- Multiple layoffs post-acquisition (200+ June 2023, 255+ Dec 2023)
- New CEO Ashan Willy (former Proofpoint CEO) appointed Dec 2023

##### Free Tier Details

| Feature | Limit |
|---------|-------|
| Data Ingest | **100 GB/month** |
| Retention | 8 days |
| Full Users | 1 |
| Basic Users | Unlimited (view-only, limited features) |
| Synthetic Checks | 500 |
| Integrations | 750+ |
| Credit Card | Not required |

**What Basic Users CAN'T Do:**
- Use APM UI, Browser Monitoring UI, Mobile UI
- Access curated experiences
- Only view-only/query permissions

##### Critical Limitation: Hard Cutoff

**⚠️ WARNING: When you exceed 100 GB, data ingest STOPS and you LOSE PLATFORM ACCESS.**

- At 85%: Email + on-screen warning
- At 100%: Complete cutoff until next month or upgrade
- No graceful degradation - your monitoring dies

##### Pricing Beyond Free

| Tier | User Cost | Data Cost |
|------|-----------|-----------|
| Standard | $99/user (max 5) | $0.30-0.40/GB |
| Pro | $349-419/user | $0.30-0.40/GB |
| Data Plus | +$0.20/GB | 90-day retention, HIPAA |

**Known Issues:**
- Complex billing model
- Reports of surprise 10x bill increases
- Per-user costs compound quickly
- PE ownership may prioritize profit extraction

##### Why Consider
- ✅ Largest free data allowance (100 GB)
- ✅ Full-featured APM platform
- ✅ Excellent OTLP support
- ✅ Established company with resources

##### Why NOT to Choose
- ❌ Hard cutoff at 100 GB (monitoring dies)
- ❌ Only 8-day retention
- ❌ 1 full user (others are limited)
- ❌ Complex/expensive when scaling
- ❌ PE ownership + layoffs = uncertainty
- ❌ Known for billing surprises

**Links:**
- [Free Tier](https://newrelic.com/pricing/free-tier)
- [Pricing](https://newrelic.com/pricing)
- [OTLP Docs](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/)

---

#### 0c. Honeycomb (Best Retention + Graceful Degradation)

##### Company Profile

| Attribute | Details |
|-----------|---------|
| **Founded** | 2016 |
| **Status** | Private (Series D) |
| **Total Funding** | $150M across 5 rounds |
| **Latest Round** | $50M Series D (2023) |
| **Employees** | ~238 |
| **Revenue** | ~$10.8M/year |
| **HQ** | San Francisco, CA |

**Founders:**
- Charity Majors (CTO) - well-known in observability community
- Christine Yen (CEO)
- Both previously at Parse (acquired by Facebook)

**Recent News:**
- April 2025: First acquisition (Grit)
- Frontend Observability now GA
- Strong OpenTelemetry leadership (engineers contribute to spec)
- Named Gartner Visionary in observability

##### Free Tier Details

| Feature | Limit |
|---------|-------|
| Events | **20 million/month** |
| Retention | **60 days** (best in class) |
| Users | **Unlimited** |
| Triggers (Alerts) | 2 |
| Rate Limit | 2,000 events/sec |
| Credit Card | Not required |

**What Counts as an Event:**
- Each span in a trace = 1 event
- A trace with 150 spans = 150 events
- Event size doesn't matter (fields are free)
- 20M events ≈ 5-15 GB depending on trace complexity

##### Critical Advantage: Graceful Degradation

**✅ Honeycomb NEVER completely cuts you off.**

**Burst Protection System:**
1. First overage: Yellow warning
2. Continued overage: Red warning
3. After 10-day grace period: Throttling (10% sampling)
4. Even when throttled: You still see 90% of your data

**Compare to New Relic:** Complete cutoff vs graceful sampling

##### Pricing Beyond Free

| Tier | Cost | Events |
|------|------|--------|
| Free | $0 | 20M/month |
| Pro | $100-130/month | 100M-1.5B/month |
| Enterprise | $24,000+/year | 10B+/year |

**Pricing Model:**
- Event-based (not GB-based)
- No per-user charges at any tier
- No penalty for wide events (many fields)
- Encourages comprehensive instrumentation

##### Unique Features

**BubbleUp:** AI-powered outlier detection
- Select anomalous data points visually
- Automatically analyzes hundreds of dimensions
- Shows which attributes explain the difference
- Dramatically accelerates debugging

**High-Cardinality Excellence:**
- Sub-second queries on complex datasets
- No penalty for many unique values
- Purpose-built for distributed tracing

##### Why Consider
- ✅ 60-day retention (longest free tier)
- ✅ Unlimited users (team-friendly)
- ✅ Graceful degradation (never cut off)
- ✅ Excellent distributed tracing
- ✅ Strong OTLP/OpenTelemetry support
- ✅ Healthy startup (no PE/layoff concerns)
- ✅ BubbleUp is genuinely powerful

##### Why NOT to Choose
- ❌ 20M events may not be enough for production
- ❌ Steep learning curve (different mental model)
- ❌ Jump to paid is steep ($0 → $100+)
- ❌ Smaller company (could be acquired)
- ❌ Weaker for logs/infrastructure monitoring
- ❌ Only 2 alert triggers on free tier

**Links:**
- [Pricing](https://www.honeycomb.io/pricing)
- [OpenTelemetry](https://www.honeycomb.io/platform/opentelemetry)
- [BubbleUp](https://www.honeycomb.io/platform/bubbleup)

---

#### 0d. OpenObserve (Simplest Self-Hosting)

**Self-Hosted (Completely Free):**
- Single binary - no external databases needed
- Runs on as little as 512MB RAM
- Can ingest 2 TB/day on a single machine

**Setup (One Command):**
```bash
docker run -d -v /data:/data \
  -e ZO_ROOT_USER_EMAIL=you@example.com \
  -e ZO_ROOT_USER_PASSWORD=YourPassword123 \
  -p 5080:5080 \
  openobserve/openobserve:latest
```

**Cost with Hetzner VPS:**
- CX11 (1GB RAM): €2.49/month (~$2.70)
- CX23 (4GB RAM): €3.49/month (~$3.80)

**Why Consider:**
- **Simplest self-hosted option** - no ClickHouse/PostgreSQL/Redis
- Runs on cheapest VPS available
- 5-minute setup, minimal maintenance
- Native OTLP support

**Gotchas:**
- Newer project (less mature than SigNoz/Uptrace)
- Cloud offering still developing
- Less community documentation

**Links:**
- [Getting Started](https://openobserve.ai/docs/getting-started/)
- [GitHub](https://github.com/openobserve/openobserve)

---

#### 1. Axiom (Best for High Volume)

**Free Tier (Personal Plan):**
- 500 GB data ingest/month
- 25 GB storage
- 10 GB-hours query compute
- 30-day retention
- 2 datasets max

**Cloud Tier ($25/month base):**
- 1,000 GB/month ingest allowance (included)
- 100 GB-hours/month query compute (included)
- 100 GB storage (included)
- Configurable retention per dataset

**Usage Pricing:**
- Data loading: $0.12/GB (standard), $0.09/GB (bulk)
- Query compute: $0.12-0.20/GB-hour
- Storage: $0.03/GB/month (compressed, ~95% compression)

**Volume Discounts (Pre-purchased credits):**
- 25K-100K credits: 10% off ($0.90/credit)
- 100K-250K: 15% off ($0.85/credit)
- 250K+: 20-30% off

**Why Consider:**
- Most generous allowances for paid tier
- Native OTLP support for traces, metrics, logs
- 95% compression ratio
- Petabyte-scale capable
- No per-user fees

**Links:**
- [Pricing](https://axiom.co/pricing)
- [OpenTelemetry Docs](https://axiom.co/docs/send-data/opentelemetry)

##### Deep Dive: Axiom Personal Limitations

**⚠️ WARNING: The "500 GB free" marketing hides severe operational limits.**

| Limit | Personal (Free) | Cloud ($25/mo) | Impact |
|-------|-----------------|----------------|--------|
| Datasets | **2 max** | 100 | Traces + logs = done |
| Users | **1 only** | 100+ | No team access |
| Monitors | **3 max** | 500 | Minimal alerting |
| Alerts to | Email/Discord only | Slack, PagerDuty, webhooks | No incident response |
| Query compute | 10 GB-hours | 100 GB-hours | Dashboards eat this fast |
| Fields/dataset | 256 | 1,024 | Schema constraints |
| Retention | 30 days (fixed) | Configurable | No compliance support |
| SSO/RBAC | ❌ | Add-on ($50-100/mo) | No enterprise auth |

**The "2 Datasets" Problem:**
- Dataset 1: Application traces
- Dataset 2: Application logs
- **Nothing left for:** Infrastructure logs, security logs, metrics, third-party integrations
- Workaround: Combine everything into 1-2 datasets and filter by `service.name` (reduces query flexibility)

**Query Compute Exhaustion:**
- 10 GB-hours/month ≈ 830 MB/day of query compute
- A dashboard with 12 panels auto-refreshing every 5 min can use 3-4 GB-hours/month
- Complex aggregations or JOINs consume compute rapidly
- Heavy users hit limits mid-month

**Fair Use Policy Risk:**
- Axiom can **suspend or terminate** accounts deemed "abusive"
- No specific metrics defining abuse
- Burst traffic patterns may trigger review
- Enforcement at "Axiom's sole discretion"

**Axiom Personal is NOT suitable for:**
- ❌ Production apps with multiple services (2 dataset limit)
- ❌ Teams >1 person (single user only)
- ❌ Apps needing Slack/PagerDuty alerts (Email/Discord only)
- ❌ Apps requiring >30-day history (compliance, debugging)
- ❌ Apps with unpredictable traffic (abuse suspension risk)

**Axiom Personal IS suitable for:**
- ✅ Solo developer hobby projects
- ✅ Learning/evaluation (2-week trial)
- ✅ Single-service prototypes
- ✅ Personal blogs/small sites with minimal observability needs

**Upgrade Path:**
- Cloud tier: $25/month (10x compute, 50x datasets, 100 users)
- With SSO: +$100/month
- With RBAC: +$50/month
- **Production minimum: ~$75-175/month**

---

#### 2. Better Stack (Easy Setup, But Expensive at Scale)

**Free Tier:**
- 3 GB logs (3-day retention)
- 2 billion metrics points (30-day retention)
- 10 monitors
- Free SMS/Slack alerts

**Paid Pricing (Warning: Per-User Fees):**
- Responder licensing: $29/user/month (annual) or $34/month (monthly)
- Slack workflows: +$9/responder/month
- Telemetry bundles:
  - Nano: $25/mo (50 GB traces + 50 GB logs)
  - Micro: $100/mo (210 GB each)
  - Mega: $210/mo (450 GB each)
- Overage: $0.15/GB (Team), $0.10/GB (Pro)

**Hidden Costs:**
- Per-responder fees escalate quickly with team growth
- Extra monitors: $25/50 monitors
- SSO: $5/user/month
- Audit logs: $250/month

**Why Consider:**
- Minutes to deploy
- Native OTLP via eBPF collector
- Unified uptime + logs + traces
- Good for solo developers or very small teams

**Why NOT to Choose:**
- 3-4x more expensive than alternatives for small teams
- Per-user fees compound costs quickly

**Links:**
- [Pricing](https://betterstack.com/pricing)
- [OpenTelemetry Docs](https://betterstack.com/docs/logs/open-telemetry/)

---

#### 3. SigNoz (Recommended for Self-Hosting)

**Free Tier (Self-Hosted):**
- Unlimited data
- 15 days retention (logs/traces)
- 30 days retention (metrics)
- All features included

**Cloud:** $49/month base, $0.30/GB logs/traces

**Why Consider:**
- True open source (Apache 2.0)
- OpenTelemetry-native from ground up
- No per-user fees
- ClickHouse-powered (fast queries)
- Startup program: $19/month

**Links:**
- [Pricing](https://signoz.io/pricing/)
- [GitHub](https://github.com/SigNoz/signoz)

---

#### 4. HyperDX (Simple Flat Pricing - Cloud Only)

**Status:** Acquired by ClickHouse (March 2025)

**Free Tier:**
- 3 GB/month storage
- 3-day retention
- 1 user max
- 14-day starter trial

**Paid Pricing:**
- Starter: $20/month flat (50 GB, 30-day retention, unlimited users)
- Overage: $0.40/GB
- Metrics: $0.40 per 100 metrics (1 DPM)
- Enterprise: Custom pricing with SAML SSO

**Important Change:**
- ⚠️ **No self-hosted option available** (cloud-only since acquisition)
- GitHub repo still exists but self-hosting not supported

**Why Consider:**
- Simple, predictable $20/month flat fee
- Unified session replays + logs + traces
- Built on OpenTelemetry
- Good for teams who want simplicity over lowest cost

**Links:**
- [Website](https://www.hyperdx.io)
- [Pricing](https://www.hyperdx.io/pricing)

---

#### 5. Uptrace (Best Overall Value - RECOMMENDED)

**Free Trial:**
- 1.2 TB data ingestion (!)
- 100,000 timeseries
- No credit card required
- Full feature access

**Cloud Pricing (Tiered by Budget):**

| Monthly Tier | Per-GB Cost | Allocation |
|--------------|-------------|------------|
| $5/month | $0.10/GB | 50 GB |
| $99/month | $0.08/GB | 1.22 TB |
| $199/month | $0.065/GB | 3 TB |
| $499/month | $0.06/GB | 8 TB |
| $999/month | $0.05/GB | 20 TB |
| $4,999+/month | $0.015/GB | Custom |

**Billing:**
- No minimum monthly spend
- Billed at end of month OR every $400, whichever first

**Self-Hosted (Completely Free):**
- Open source, no feature limits
- Docker & Kubernetes deployment
- Requires: ClickHouse, PostgreSQL, Redis
- Zero licensing fees

**Why This is #1 Recommendation:**
- Cheapest per-GB pricing ($0.08/GB)
- Massive 1.2 TB free trial
- Free self-hosted option
- No per-user fees
- Budget caps prevent surprises
- 10-20x compression via ClickHouse

**Links:**
- [Pricing](https://uptrace.dev/pricing)
- [GitHub](https://github.com/uptrace/uptrace)
- [Self-Hosted Install](https://uptrace.dev/get/hosted/install)

---

#### 6. Highlight.io / LaunchDarkly (Migrating)

**⚠️ Migration Deadline: February 28, 2026**

Acquired by LaunchDarkly (April 2025). Current plans continue until migration.

**Current Highlight.io Pricing:**
- Free: $0/month (500 sessions, 15 seats)
- Pay-as-you-go: $50/month base + usage (7-day retention)
- Business: $800/month (unlimited dashboards/projects/seats)
- Enterprise: Custom pricing (SAML SSO, audit logs)

**What Happens After Feb 2026:**
- Infrastructure migration to LaunchDarkly ~6-12 months
- SDK migration gradual (not immediate)
- Current pricing continues with clear communication on changes
- Support continues via support@highlight.io

**Why Consider:**
- Full-stack with session replay (like Sentry but unified)
- Free tier includes 500 sessions/month
- Good if you need session replay + observability

**Why NOT to Choose Right Now:**
- Migration uncertainty
- Unclear pricing post-LaunchDarkly integration
- Better to wait until post-migration pricing is clear

**Links:**
- [Highlight Pricing](https://www.highlight.io/pricing)
- [Migration Info](https://www.highlight.io/blog/launchdarkly-migration)

---

### New Vendors (2025-2026)

#### 7. CubeAPM (Cheapest SaaS - NEW)

**Pricing:**
- $0.15/GB all-inclusive (logs, metrics, traces, infrastructure)
- No per-seat fees
- No per-host fees
- No hidden add-ons
- Support bundled

**Small Team Cost:**
- 10 GB/month: $1.50
- 30 GB/month: $4.50
- 50 GB/month: $7.50

**Why Consider:**
- Simplest, most transparent pricing
- OTLP-native
- Emerging vendor with aggressive pricing
- Good for budget-conscious teams

**Links:**
- [Website](https://cubeapm.com)
- [Pricing](https://cubeapm.com/pricing)

---

#### 8. Dash0 (Signal-Based Pricing - NEW)

**Recent Change:** Removed base subscription fee (2025)

**Pricing (Per Signal, Not Per Byte):**
- Metric data points: $0.20 per million (13-month retention)
- Spans/span events: $0.60 per million (30-day retention)
- Log records: $0.60 per million (30-day retention)
- Web events: $0.60 per million (30-day retention)
- Synthetic API checks: $0.20 per thousand

**Free Trial:**
- 14-day unlimited access

**Small Team Cost (Estimated):**
- Varies by signal volume, not data volume
- Approximately $30-150/month for typical small team

**Why Consider:**
- Modern OTLP-native platform
- Signal-based pricing can be cheaper for high-compression data
- No base subscription fee

**Why NOT to Choose:**
- Pricing harder to predict (signals vs bytes)
- Newer vendor, less established

**Links:**
- [Pricing](https://www.dash0.com/pricing)
- [No Base Fee Announcement](https://www.dash0.com/changelog/no-more-base-subscription-fee)

---

## Migration Effort Estimate

### Minimal Changes Required

Since the codebase is OTLP-native, migration is straightforward:

1. **Environment Variables Only (5 minutes)**
   - Update `OTEL_EXPORTER_OTLP_ENDPOINT`
   - Update `OTEL_EXPORTER_OTLP_HEADERS`
   - Update `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT`
   - Update `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN`

2. **Optional: Enable All Log Levels**
   - Set `OTEL_SEND_ALL_LOG_LEVELS=true` in production
   - Redeploy with `NEXT_PUBLIC_LOG_ALL_LEVELS=true` for client

### What Doesn't Need to Change

- ✅ All tracing code (`instrumentation.ts`, `browserTracing.ts`, `fetchWithTracing.ts`)
- ✅ All logging code (`otelLogger.ts`, `consoleInterceptor.ts`, `remoteFlusher.ts`)
- ✅ API routes (`/api/traces`, `/api/client-logs`)
- ✅ Sentry configuration (separate system)

---

## Recommendations (Updated Jan 2026)

### Ranked by Cost (Small Team: 2-5 devs, 10-50 GB/month)

| Rank | Vendor | Monthly Cost | Recommendation |
|------|--------|--------------|----------------|
| 1 | **Grafana Cloud** | $0 | **BEST FREE** - 150 GB, 14-day retention, 3 users |
| 2 | **New Relic** | $0 | 100 GB free, 8-day retention |
| 3 | **Honeycomb** | $0 | 20M events, 60-day retention, unlimited users |
| 4 | **OpenObserve (self-host)** | ~$3 | Simplest self-host, 1 docker command |
| 5 | **SigNoz/Uptrace (self-host)** | ~$6 | More mature, needs more resources |
| 6 | **CubeAPM** | $1.50-$7.50 | Cheapest paid SaaS |
| 7 | **Uptrace Cloud** | $1-$4 | Best paid value after trial |
| 8 | **HyperDX** | $20 flat | Simple flat pricing |
| ❌ | **Axiom Personal** | $0 | **AVOID** - 2 datasets, 1 user, 3 monitors |
| ❌ | **Better Stack** | $108-239 | **AVOID** - per-user fees |

### Primary Recommendation

**For free cloud (no infra):** Use **Grafana Cloud** free tier - 150 GB total, 14-day retention, 3 users, full Slack/PagerDuty alerting. This is the clear winner.

**For simplest self-hosting:** Use **OpenObserve** on Hetzner CX23 (~$3.80/month) - single docker command, minimal maintenance.

**For most mature self-hosting:** Use **SigNoz** or **Uptrace** on Hetzner CX33 (~$6/month) - more features, better documentation.

### Production-Viable Free Cloud Tiers

**YES, they exist!** These are NOT limited like Axiom Personal:

| Vendor | Free Storage | Retention | Users | Alerting |
|--------|--------------|-----------|-------|----------|
| **Grafana Cloud** | 150 GB | 14 days | 3 active | Slack, PagerDuty, webhooks ✅ |
| **New Relic** | 100 GB/month | 8 days | 1 full + unlimited basic | Full ✅ |
| **Honeycomb** | 20M events | 60 days | Unlimited | Full ✅ |

### Vendors to Avoid

- **Axiom Personal** - "500 GB free" hides: 2 datasets, 1 user, 3 monitors, Email/Discord only
- **Better Stack** - Per-user fees ($29/user) make it 3-4x more expensive
- **Highlight.io** - Migration to LaunchDarkly by Feb 2026, uncertain future

### Self-Hosting: Actually Simple

If you want to avoid any cloud dependency, self-hosting is easier than expected:

**OpenObserve (Simplest):**
```bash
# One command on any VPS with Docker
docker run -d -v /data:/data \
  -e ZO_ROOT_USER_EMAIL=you@example.com \
  -e ZO_ROOT_USER_PASSWORD=YourPassword123 \
  -p 5080:5080 openobserve/openobserve:latest
```
- Cost: ~$3/month (Hetzner CX23)
- Setup: 5 minutes
- Maintenance: Minimal (single binary)

**SigNoz (More Mature):**
```bash
git clone https://github.com/SigNoz/signoz.git && cd signoz/deploy
docker compose up -d
```
- Cost: ~$6/month (Hetzner CX33, needs 4GB+ RAM)
- Setup: 10-15 minutes
- Maintenance: Low (occasional updates)

### Migration Priority

1. **Easiest path:** Sign up for Grafana Cloud free tier
2. Get OTLP endpoint URL and auth token from Grafana
3. Update environment variables in `.env.prod`
4. Set `OTEL_SEND_ALL_LOG_LEVELS=true` to capture all log levels
5. Deploy and verify traces/logs appear in Grafana dashboard

**Note:** Since you're already using Grafana (Tempo/Loki), Grafana Cloud free tier is the most seamless migration - same UI, same query languages.

---

## Honeycomb vs Axiom Comparison

Since both Honeycomb and Axiom are frequently mentioned as modern observability alternatives, here's a detailed comparison:

### At-a-Glance

| Factor | Honeycomb | Axiom |
|--------|-----------|-------|
| **Founded** | 2016 | 2016 |
| **Funding** | $150M (Series D) | $59M (Series B) |
| **Employees** | ~238 | ~54 |
| **Free Tier Storage** | 20M events | 500 GB |
| **Free Tier Retention** | 60 days | 30 days |
| **Free Tier Users** | Unlimited | 1 only |
| **Free Tier Datasets** | Unlimited | 2 max |
| **Free Tier Alerts** | 2 triggers | 3 monitors |
| **Alert Integrations** | Full (Slack, PagerDuty) | Email/Discord only |
| **Overage Behavior** | Graceful (10% sampling) | Hard cutoff |
| **Pricing Model** | Event-based | GB-based |
| **Primary Strength** | Distributed tracing | High-volume logs |
| **OTLP Native** | ✅ Yes | ✅ Yes |

### Free Tier Reality Check

**Honeycomb (20M events):**
- ✅ Unlimited users can collaborate
- ✅ Unlimited datasets for organization
- ✅ Slack/PagerDuty/webhook alerts
- ✅ 60-day retention (longest)
- ✅ Graceful degradation (never fully cut off)
- ⚠️ 20M events may run out with complex traces

**Axiom Personal (500 GB):**
- ❌ Single user only (no team access)
- ❌ 2 datasets total (traces + logs = done)
- ❌ Email/Discord alerts only (no Slack/PagerDuty)
- ❌ 3 monitors maximum
- ❌ Hard cutoff at limits
- ⚠️ 500 GB sounds generous but operational limits are severe

### Event-Based vs GB-Based Pricing

**Honeycomb's Model:**
- Pay per event (span, log entry)
- Wide events (many fields) are FREE
- Encourages comprehensive instrumentation
- 20M events ≈ 5-15 GB depending on trace complexity
- Predictable costs per request volume

**Axiom's Model:**
- Pay per GB ingested
- Large events cost more
- May encourage sparse instrumentation
- Query compute also costs extra
- Costs scale with verbosity

### Company Health Comparison

| Factor | Honeycomb | Axiom |
|--------|-----------|-------|
| Revenue | ~$10.8M | Not disclosed |
| Runway | Strong (Series D) | Good (Series B) |
| Team Size | ~238 | ~54 |
| Profitability | Not yet | Not yet |
| Acquisition Risk | Lower | Higher |
| PE Ownership | No | No |

### Technical Philosophy

**Honeycomb:**
- Built for distributed tracing first
- "Observability 2.0" - high-cardinality queries
- BubbleUp for AI-powered debugging
- Weaker for traditional logs/infrastructure
- Steep learning curve (different mental model)

**Axiom:**
- Built for log aggregation first
- More traditional observability model
- Query language familiar to Splunk/ELK users
- Strong on high-volume data ingestion
- Easier for teams coming from legacy platforms

### When to Choose Each

**Choose Honeycomb if:**
- ✅ Team collaboration is essential (unlimited users)
- ✅ Tracing is your primary use case
- ✅ You want 60-day retention
- ✅ You need Slack/PagerDuty alerting
- ✅ You want graceful degradation
- ✅ You'll instrument comprehensively (wide events free)

**Choose Axiom if:**
- ✅ Solo developer project
- ✅ High-volume logs (500 GB > 20M events for you)
- ✅ You only need 1-2 datasets
- ✅ Email alerts are sufficient
- ✅ You don't need team collaboration
- ✅ You'll use the Cloud tier ($25/month) anyway

### Verdict

**For production with a team: Honeycomb wins.**

Honeycomb's unlimited users, full alerting integrations, 60-day retention, and graceful degradation make it production-viable. Axiom Personal's "500 GB free" is marketing - the 2 datasets, 1 user, 3 monitors limits make it unsuitable for real production use.

**For solo developers with simple needs: Axiom may work.**

If you're a single developer with one app and don't need Slack alerts, Axiom Personal's 500 GB could be sufficient.

**Neither is the best free tier overall.** Grafana Cloud (150 GB, 3 users, full alerting, 14-day retention) beats both for most teams.

---

## Company Profiles

### Grafana Labs

| Attribute | Details |
|-----------|---------|
| **Founded** | 2014 (Stockholm, Sweden) |
| **Status** | Private (Series D) |
| **Total Funding** | $840M |
| **Valuation** | $6B (as of 2022) |
| **Employees** | 1,500+ |
| **HQ** | New York, NY (now) |
| **CEO** | Raj Dutt (co-founder) |

**History:**
- 2014: Founded by Torkel Ödegaard who created Grafana OSS in 2013
- 2017: $24M Series A
- 2019: $50M Series B, acquired Loki and Tempo creators
- 2021: $220M Series C at $3B valuation
- 2022: $240M Series D at $6B valuation
- 2024: Acquired k6.io for load testing

**Why This Matters:**
- Strongest funding in the observability space
- Owns the most popular dashboarding tool (Grafana)
- Created the LGTM stack (Loki, Grafana, Tempo, Mimir)
- Large team = strong R&D and support
- No PE ownership = less profit extraction pressure

**Risk Factors:**
- High valuation may pressure monetization
- Complex product portfolio to maintain
- Competition from Datadog, New Relic

---

### Axiom

| Attribute | Details |
|-----------|---------|
| **Founded** | 2016 (London, UK) |
| **Status** | Private (Series B) |
| **Total Funding** | $59M |
| **Latest Round** | $35M Series B (Sep 2024) |
| **Employees** | ~54 |
| **HQ** | Remote-first, UK-based |
| **CEO** | Neil Roseman |

**History:**
- 2016: Founded by Neil Roseman (ex-Amazon/Infer AI)
- Built on serverless architecture from start
- 2022: $24M funding
- 2024: $35M Series B led by Crane Venture Partners
- Aggressive growth in cloud observability market

**Why This Matters:**
- Smaller team = more nimble but less resources
- Serverless-native architecture
- Strong on high-volume data handling
- Growing but not yet profitable

**Risk Factors:**
- Smaller company, higher acquisition risk
- Free tier marketing may not be sustainable
- Series B = still proving product-market fit

---

### OpenObserve

| Attribute | Details |
|-----------|---------|
| **Founded** | 2022 |
| **Status** | Private (Seed) |
| **Total Funding** | $3.6M |
| **Employees** | ~27 |
| **HQ** | San Francisco, CA |
| **Founders** | Prabhat Sharma, Hengfeng Li |

**History:**
- 2022: Founded as ZincSearch (search-focused)
- 2023: Pivoted to full observability platform
- Renamed to OpenObserve
- Built Rust-based single binary architecture
- Open source (Apache 2.0)

**Why This Matters:**
- Smallest, newest entrant in this list
- Simplest self-hosting option (single binary)
- Very lean team, high efficiency
- Open source ensures no lock-in

**Risk Factors:**
- Early stage company, limited funding
- Small team = slower feature development
- Cloud offering still developing
- Less documentation and community

---

### SigNoz

| Attribute | Details |
|-----------|---------|
| **Founded** | 2021 |
| **Status** | Private (Series A) |
| **Total Funding** | $7M+ |
| **Employees** | ~38 |
| **HQ** | Bengaluru, India |
| **Founders** | Pranay Prateek, Ankit Nayan |
| **Accelerator** | Y Combinator (W21) |

**History:**
- 2021: Founded by ex-Microsoft engineers
- YC W21 batch
- 2021: $3.25M seed led by SignalFire
- Built OpenTelemetry-native from day one
- Growing open source community (19k+ GitHub stars)

**Why This Matters:**
- Y Combinator backing (strong network)
- True open source (Apache 2.0)
- OpenTelemetry-native from ground up
- ClickHouse-powered = fast queries
- Growing community

**Risk Factors:**
- Early stage, limited funding vs competitors
- Team mostly in India (timezone considerations)
- Cloud product less mature than self-hosted

---

### Uptrace

| Attribute | Details |
|-----------|---------|
| **Founded** | Unknown (Moldova-based) |
| **Status** | Private, Bootstrapped |
| **Funding** | None disclosed (profitable) |
| **Team** | ~150 engineers |
| **HQ** | Moldova |
| **CEO** | Vladimir Mihailenco |

**History:**
- Created by Vladimir Mihailenco (author of go-redis)
- Bootstrapped and profitable
- Open source self-hosted version
- Focus on simplicity and cost-efficiency
- Strong Eastern European engineering team

**Why This Matters:**
- Profitable = no VC pressure, sustainable
- Best per-GB pricing in the market
- No per-user fees at any tier
- Large engineering team for a bootstrapped company
- Author's credibility from go-redis (widely used)

**Risk Factors:**
- Less marketing = lower awareness
- Moldova-based (geopolitical considerations)
- Smaller ecosystem/community vs others

---

### HyperDX

| Attribute | Details |
|-----------|---------|
| **Founded** | 2022 |
| **Status** | Acquired by ClickHouse (March 2025) |
| **Previous Funding** | ~$1M seed |
| **Team Size** | 4 (at acquisition) |
| **Founders** | Warren Liu, Mike Shi |

**History:**
- 2022: Founded by Warren Liu (ex-Google) and Mike Shi (ex-Microsoft)
- Open source observability platform
- Focus on developer experience
- March 2025: Acquired by ClickHouse Inc.
- Now cloud-only (no self-hosting)

**Why This Matters:**
- ClickHouse backing = strong database foundation
- Simple, developer-friendly UX
- Unified logs + traces + session replays
- Predictable $20/month pricing

**Risk Factors:**
- Post-acquisition direction unclear
- Self-hosting option removed
- Small team may be absorbed into ClickHouse
- Product roadmap may shift

---

### Better Stack

| Attribute | Details |
|-----------|---------|
| **Founded** | 2021 (Prague, Czech Republic) |
| **Status** | Private |
| **Total Funding** | $28.6M |
| **Employees** | 28-50 |
| **HQ** | Prague, Czech Republic |
| **CEO** | Juraj Masar |

**History:**
- Originally called Uptime.com rebranded
- 2022: $2.6M seed
- 2023: $26M Series A led by CRV
- Combines uptime monitoring + logging + APM
- Strong focus on UI/UX

**Why This Matters:**
- Well-funded for a focused observability player
- Strong design/UX emphasis
- Unified uptime + observability in one platform
- European company (GDPR-native)

**Risk Factors:**
- Per-user pricing expensive at scale
- Smaller team vs larger competitors
- Less open source involvement
- Premium positioning may limit SMB adoption

---

### CubeAPM

| Attribute | Details |
|-----------|---------|
| **Founded** | 2023 |
| **Status** | Private, Bootstrapped |
| **Funding** | None (unfunded) |
| **Team Size** | Small (undisclosed) |
| **HQ** | India |

**History:**
- 2023: Founded as cost-efficient APM alternative
- Targeting teams priced out by Datadog/New Relic
- Focus on transparent pricing ($0.15/GB all-in)
- OTLP-native from start

**Why This Matters:**
- Cheapest SaaS option available
- No hidden fees or per-user charges
- Aggressively positioned against expensive vendors
- Transparent, simple pricing

**Risk Factors:**
- Newest vendor, least established
- No funding = limited runway if needed
- Very small team
- Less documentation and community

---

### Dash0

| Attribute | Details |
|-----------|---------|
| **Founded** | 2023 (Linz, Austria) |
| **Status** | Private (Series A) |
| **Total Funding** | $44.5M |
| **Employees** | ~50+ |
| **HQ** | Linz, Austria |
| **CEO** | Mirko Novakovic |

**History:**
- 2023: Founded by Mirko Novakovic (founder of Instana, sold to IBM for $280M)
- 2023: $13.5M seed (Accel, Index Ventures, Lakestar)
- 2024: $31M Series A
- Built by team with deep observability experience
- Signal-based pricing model (not GB-based)

**Why This Matters:**
- Founder sold Instana to IBM for $280M
- Very experienced team in observability
- Strong VC backing (Accel, Index)
- Recently removed base subscription fee
- Modern OTLP-native architecture

**Risk Factors:**
- Newer to market (2023)
- Signal-based pricing harder to predict
- Competition from well-funded incumbents
- Must prove differentiation

---

## Grafana Cleanup Assessment

After selecting Honeycomb, a multi-agent review assessed what Grafana-related code and configuration requires cleanup. This section documents the findings.

### Cleanup Priority Summary

| Priority | Count | Description |
|----------|-------|-------------|
| 🔴 MUST FIX | 6 | Blocks migration or confuses developers |
| 🟡 SHOULD FIX | 6 | Misleading but doesn't break functionality |
| 🟢 OPTIONAL | 3+ | Cosmetic (test mocks, archived docs) |

### 🔴 MUST FIX Items

#### 1. Environment Variables - `.env.example`
**Lines 22-42**

| Variable/Comment | Action |
|-----------------|--------|
| Comment: "Grafana Cloud OTLP" | Change to "OTLP Backend (Honeycomb)" |
| `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT` | Remove entirely |
| `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` | Remove entirely |
| `LOKI_ADDR`, `LOKI_USERNAME`, `LOKI_PASSWORD` | Remove or mark deprecated |

#### 2. Environment Variables - `.env.local`
**Lines 7-11**
- Update `OTEL_EXPORTER_OTLP_ENDPOINT` to Honeycomb
- Update `OTEL_EXPORTER_OTLP_HEADERS` to Honeycomb auth
- Remove `NEXT_PUBLIC_GRAFANA_*` variables

#### 3. Debug Page - `/test-cors`
**File:** `src/app/(debug)/test-cors/page.tsx`

This page hardcodes Grafana endpoints and should be deleted or updated:
- Line 22-24: `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT` fallback to `grafana.net`
- Line 82-91: Decision tree mentions "Grafana Faro"
- Line 100: Page title "CORS Test for Grafana OTLP"

#### 4. Scripts - `query-logs.sh`
**File:** `scripts/query-logs.sh`

Uses Grafana Loki's LogCLI (incompatible with Honeycomb). Should be archived.

#### 5. Documentation - `environments.md`
**File:** `docs/docs_overall/environments.md`

| Line(s) | Change |
|---------|--------|
| 14-15 | "Grafana + Sentry" → "Honeycomb + Sentry" |
| 209 | Update "Both have Grafana OTLP" |
| 217-221 | Update Grafana OTLP description |
| 223-254 | Update LogCLI section (Grafana Loki-specific) |
| 274-279 | Update OTLP variable descriptions |

#### 6. Vercel Dashboard Environment Variables
**Location:** Vercel → Project Settings → Environment Variables

| Variable | Action |
|----------|--------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Update to `https://api.honeycomb.io` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Update to `x-honeycomb-team=<KEY>` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Add: `http/protobuf` |
| `OTEL_SERVICE_NAME` | Add: `explainanything` / `explainanything-staging` |
| `NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT` | Delete |
| `NEXT_PUBLIC_GRAFANA_OTLP_TOKEN` | Delete |

### 🟡 SHOULD FIX Items (Code Comments)

These are misleading but don't break functionality:

| File | Lines | Content |
|------|-------|---------|
| `src/app/api/traces/route.ts` | 2, 4, 43, 52 | "Grafana Cloud" → "OTLP backend" |
| `src/lib/tracing/browserTracing.ts` | 5, 60 | "Grafana" → "backend" |
| `src/lib/logging/server/otelLogger.ts` | 2, 4, 94 | "Grafana Loki" → "OTLP backend" |
| `src/app/api/client-logs/route.ts` | 39 | "Grafana" → "OTLP backend" |
| `src/components/ClientInitializer.tsx` | 14, 35 | "Grafana" → "backend" |
| `src/lib/server_utilities.ts` | 65 | "Grafana" → "OTLP backend" |

### 🟢 OPTIONAL Items (Cosmetic)

- Test files using `mock.grafana.net` placeholder URLs
- Test descriptions mentioning "Grafana"
- Planning docs in `/docs/planning/` (historical reference)

### External Services Status

| Service | Grafana References | Action Required |
|---------|-------------------|-----------------|
| Vercel Dashboard | 6 env vars | Update/delete (see above) |
| GitHub Actions | None | No action needed |
| GitHub Secrets | None | No action needed |

### Key Insight

The codebase was built on OTLP-generic patterns, so production code paths don't reference Grafana directly. The hardcoded Grafana references are almost entirely in:
- Comments (6 files)
- Debug tooling (1 page)
- Environment variable templates
- Documentation

This makes migration primarily an env var change with documentation cleanup.

---

## Code Files Read

- `package.json` - Dependencies and scripts
- `instrumentation.ts` - Server-side tracing setup
- `src/lib/tracing/browserTracing.ts` - Browser tracing
- `src/lib/tracing/fetchWithTracing.ts` - Fetch wrapper with tracing
- `src/lib/logging/server/otelLogger.ts` - OTLP log exporter
- `src/lib/logging/client/consoleInterceptor.ts` - Console interception
- `src/lib/logging/client/remoteFlusher.ts` - Log batching
- `src/lib/logging/client/logConfig.ts` - Log level configuration
- `src/app/api/traces/route.ts` - Traces proxy
- `src/app/api/client-logs/route.ts` - Client logs endpoint
- `sentry.server.config.ts` - Sentry server config
- `sentry.client.config.ts` - Sentry client config
- `.env.example` - Environment variable documentation

## Documents Read

- GitHub Issue #199 - Project tracker

## Pricing Sources (Jan 2026)

- [Axiom Pricing](https://axiom.co/pricing)
- [Axiom Blog - New Pricing](https://axiom.co/blog/new-pricing-axiom-starts-lower-stays-lower)
- [Better Stack Pricing](https://betterstack.com/pricing)
- [SigNoz Pricing](https://signoz.io/pricing/)
- [SigNoz Cloud Teams Plan](https://signoz.io/blog/cloud-teams-plan-now-at-49usd/)
- [HyperDX Pricing](https://www.hyperdx.io/pricing)
- [ClickHouse Acquires HyperDX](https://clickhouse.com/blog/clickhouse-acquires-hyperdx-the-future-of-open-source-observability)
- [Uptrace Pricing](https://uptrace.dev/pricing)
- [Highlight.io Pricing](https://www.highlight.io/pricing)
- [Highlight → LaunchDarkly Migration](https://www.highlight.io/blog/launchdarkly-migration)
- [CubeAPM Comparisons](https://cubeapm.com/blog/top-hyperdx-alternatives-features-pricing/)
- [Dash0 Pricing](https://www.dash0.com/pricing)
- [Best OpenTelemetry Tools 2025](https://www.dash0.com/comparisons/best-opentelemetry-tools)
- [Honeycomb Pricing](https://www.honeycomb.io/pricing)
- [Honeycomb OpenTelemetry](https://www.honeycomb.io/platform/opentelemetry)

---

## Final Decision

### Chosen Vendor: Honeycomb

**Decision Date:** 2026-01-10

### Why Honeycomb

| Factor | Honeycomb Advantage |
|--------|---------------------|
| **Retention** | 60 days (longest among free tiers) |
| **Users** | Unlimited (team-friendly) |
| **Overage Handling** | Graceful degradation (10% sampling) - never cut off |
| **OTLP Support** | Excellent - engineers contribute to OpenTelemetry spec |
| **Tracing** | Purpose-built for distributed tracing |
| **Debugging** | BubbleUp AI-powered outlier detection |
| **Company Health** | $150M raised, ~238 employees, no PE ownership |

### Why Not Others

| Vendor | Why Rejected |
|--------|--------------|
| **Grafana Cloud** | 150 GB free is larger, but only 14-day retention vs 60-day |
| **New Relic** | Hard cutoff at 100 GB (monitoring dies), PE ownership |
| **Axiom Personal** | 2 datasets, 1 user, 3 monitors, Email/Discord only |
| **Better Stack** | Per-user fees ($29/user) too expensive |
| **Self-hosted** | Prefer managed service to reduce operational burden |

### Free Tier Limits to Monitor

| Limit | Value | Impact |
|-------|-------|--------|
| Events/month | 20 million | ~5-15 GB depending on trace complexity |
| Triggers (alerts) | 2 | Limited alerting |
| Rate limit | 2,000 events/sec | Sufficient for small-medium apps |
| Retention | 60 days | Excellent for debugging |

### Implementation Notes

The codebase is already OTLP-native. Migration requires:

1. **Sign up** at honeycomb.io
2. **Get API key** from Team Settings → Environments → API Keys
3. **Update environment variables:**
   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
   OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"
   NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=https://api.honeycomb.io  # rename later
   NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=YOUR_API_KEY
   ```
4. **Set dataset** via `OTEL_SERVICE_NAME` (defaults to service name)
5. **Deploy and verify** traces appear in Honeycomb dashboard

**Expected migration time:** <1 hour for basic setup
