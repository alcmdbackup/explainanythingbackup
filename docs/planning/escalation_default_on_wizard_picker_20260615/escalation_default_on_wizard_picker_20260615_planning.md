# Escalation default-ON + wizard picker

Follow-up to the judge-escalation work. Two changes requested:

## Phase 1: changes
- [x] Flip the escalation kill switch to **DEFAULT ON** in code: `buildRunContext` resolves a strategy's
  `ensembleConfigId` unless `EVOLUTION_JUDGE_ESCALATION_ENABLED='false'` (emergency off-switch). Still
  per-strategy opt-in: a strategy WITHOUT `ensembleConfigId` is byte-identical single-judge.
- [x] Add an **`ensembleConfigId` picker** to the strategy/experiment wizard (`strategies/new/page.tsx`):
  dropdown sourced from a new `listEnsembleConfigsAction` (server-side, so the client never imports the
  node-only chainRegistry chain). Threaded through `createStrategySchema` + config assembly + validation.

## Verification

### B) Automated Tests
- [x] `npm run test` (buildRunContext kill-switch tests updated for DEFAULT ON + per-strategy opt-in;
  chainRegistry; strategy action). Build + typecheck + lint.

### A) Playwright
- [ ] Strategy wizard renders the Judge Escalation picker (covered by build + the existing wizard E2E).
