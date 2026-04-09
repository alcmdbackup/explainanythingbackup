# Cloud Environment (Claude Code Web Only)

> **Scope:** This document applies **only** to Claude Code running in web mode (`claude.ai/code`). It does **not** apply to Claude Code CLI on local machines, CI/CD runners, or IDE extensions — those environments have direct network access and do not need the workarounds described here.

Running tests and external API calls from the Claude Code web environment (`claude.ai/code`).

## Network Architecture

The cloud environment runs in a sandboxed container (`IS_SANDBOX=yes`) with an **egress proxy** that routes all outbound traffic through Anthropic's gateway. Proxy settings are injected via `HTTP_PROXY`, `HTTPS_PROXY`, and `GLOBAL_AGENT_*` environment variables.

The proxy uses JWT-authenticated HTTP tunneling. When `allowed_hosts` is set to `*`, all external domains are permitted — but Node.js native `fetch()` does not automatically use the proxy.

## Node.js Fetch and Proxy

**Problem:** Node.js native `fetch()` (powered by Undici) does **not** honor `HTTP_PROXY`/`HTTPS_PROXY` environment variables by default. This causes `TypeError: fetch failed` when calling external APIs like Supabase, even though the proxy allows the connection.

**Solution:** Set `NODE_USE_ENV_PROXY=1` (available in Node v22.21.0+):

```bash
# Run any command that uses fetch() with proxy support
NODE_USE_ENV_PROXY=1 npm run test:integration
NODE_USE_ENV_PROXY=1 npm run test:e2e
NODE_USE_ENV_PROXY=1 node script.js
```

This tells Node to parse `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` at startup and tunnel `fetch()` requests through the proxy automatically.

**Alternative (programmatic):** Set a global Undici dispatcher:

```typescript
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new EnvHttpProxyAgent());
```

## Running Tests in Cloud Environment

### Unit Tests
Work without any special configuration — all dependencies are mocked.

```bash
npm test
```

### Integration Tests
Require `NODE_USE_ENV_PROXY=1` for Supabase connectivity:

```bash
NODE_USE_ENV_PROXY=1 npm run test:integration
NODE_USE_ENV_PROXY=1 npm run test:integration:critical
```

### E2E Tests
Require `NODE_USE_ENV_PROXY=1` for both the dev server and Playwright:

```bash
NODE_USE_ENV_PROXY=1 npm run test:e2e
```

### Lint / Typecheck / Build
No proxy needed — these don't make network calls:

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment Files

The cloud environment provides Supabase credentials via environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.), but `.env.local` and `.env.test` files are not pre-created. Create them from environment variables:

```bash
# Check available credentials
printenv | grep -iE 'SUPABASE|TEST_USER'
```

Then copy `.env.example` to `.env.local` and fill in values from the environment.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TypeError: fetch failed` | Node fetch not using proxy | Add `NODE_USE_ENV_PROXY=1` |
| Integration tests hang | Missing `.env.test` or no proxy | Create `.env.test` + use `NODE_USE_ENV_PROXY=1` |
| E2E tests can't start server | Missing `.env.local` | Create from env vars |
| `OTEL Export FAILED` | Honeycomb unreachable or OTEL not configured | Harmless in test env — ignore |

## References

- [Node.js Enterprise Network Configuration](https://nodejs.org/en/learn/http/enterprise-network-configuration)
- [Undici EnvHttpProxyAgent](https://github.com/nodejs/undici/issues/1650)
- [Node PR #57165 — HTTP_PROXY support in fetch](https://github.com/nodejs/node/pull/57165/)
