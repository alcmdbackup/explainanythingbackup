# Persist and Access Production Logs - Progress

## Plan Review Status: ✅ APPROVED

Multi-agent review completed after 5 iterations.

| Perspective | Final Score |
|-------------|-------------|
| Security & Technical | 5/5 |
| Architecture & Integration | 5/5 |
| Testing & CI/CD | 5/5 |

### Key Review Outcomes:
- **Security**: Input validation, shell injection protection, secrets management all verified
- **Architecture**: Build-time vs runtime env var distinction documented, dual-filtering explained
- **Testing**: Setup steps explicit (mkdir, npm install msw), test paths corrected

---

## Implementation Status

### Phase 1: Enable All Logs (Server + Client)
- [x] Modify `otelLogger.ts` with `OTEL_SEND_ALL_LOG_LEVELS` check
- [x] Modify `logConfig.ts` with `NEXT_PUBLIC_LOG_ALL_LEVELS` check
- [x] Update `.env.example`
- [ ] Add env vars to Vercel (manual step)

### Phase 2: Install LogCLI Access
- [x] Create `scripts/query-logs.sh`
- [x] Document LogCLI installation (in environments.md)

### Phase 3: Testing
- [x] Install MSW: `npm install -D msw`
- [x] Create directory: `mkdir -p __tests__/integration/logging`
- [x] Create `otelLogger.test.ts` (12 unit tests passing)
- [x] Create `otelLogger.integration.test.ts` (5 integration tests passing)

### Phase 4: Documentation
- [x] Update `environments.md`

### Phase 5: Verification
- [x] Run lint - passing
- [x] Run tsc - passing
- [x] Run build - passing
- [x] Run unit tests - 12 passed
- [x] Run integration tests - 5 passed
- [ ] Deploy to Vercel Preview (manual step)
- [ ] Verify logs via LogCLI (manual step)

---

## GitHub Issue
https://github.com/Minddojo/explainanything/issues/183

---

## Files Modified/Created

| File | Change |
|------|--------|
| `src/lib/logging/server/otelLogger.ts` | Added `OTEL_SEND_ALL_LOG_LEVELS` check |
| `src/lib/logging/client/logConfig.ts` | Added `NEXT_PUBLIC_LOG_ALL_LEVELS` check |
| `.env.example` | Documented new env vars and LogCLI placeholders |
| `docs/docs_overall/environments.md` | Added log levels section and LogCLI docs |
| `scripts/query-logs.sh` | New - LogCLI helper with input validation |
| `src/lib/logging/server/otelLogger.test.ts` | New - 12 unit tests |
| `__tests__/integration/logging/otelLogger.integration.test.ts` | New - 5 integration tests |
| `package.json` | Added `msw` to devDependencies |

---

## Remaining Manual Steps

1. **Vercel Environment Variables** (Production):
   - Set `OTEL_SEND_ALL_LOG_LEVELS=true`
   - Set `NEXT_PUBLIC_LOG_ALL_LEVELS=true`
   - Trigger redeploy for client-side changes

2. **LogCLI Credentials**:
   - Add `LOKI_ADDR`, `LOKI_USERNAME`, `LOKI_PASSWORD` to `.env.local`
   - Get credentials from Grafana Cloud → My Account → API Keys

3. **Verification**:
   - Generate traffic with known request ID
   - Query via: `./scripts/query-logs.sh <request-id> 1h`
