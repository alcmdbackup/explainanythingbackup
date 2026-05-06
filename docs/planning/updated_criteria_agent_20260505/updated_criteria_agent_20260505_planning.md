# Updated Criteria Agent Plan

## Background
Follow-up to `understand_critera_agent_performance_evolution_20260503`. After PR #1032 + #1036, the criteria-driven evolution agent (`agentType: criteria_and_generate`) closed 42% of the original Elo gap (-47 → -27.8) but still trails baseline. Post-merge analysis identified two distinct failure modes (rewrite disasters at 0-20% verbatim → mean -69 Elo; light-edit left-tail despite 14-19% sentence-level changes → p25 ≈ -50 Elo) and proposed a propose/approve architecture mirroring `IterativeEditingAgent` with redundancy/flow/length guardrails.

## Requirements (from user)
TBD — awaiting Step 7a/7b input.

## Problem
TBD.

## Options Considered
- [ ] **Option A:** TBD
- [ ] **Option B:** TBD

## Phased Execution Plan

### Phase 1: TBD
- [ ] TBD

## Testing

### Unit Tests
- [ ] TBD

### Integration Tests
- [ ] TBD

### E2E Tests
- [ ] TBD

### Manual Verification
- [ ] TBD

## Verification

### A) Playwright Verification
- [ ] TBD

### B) Automated Tests
- [ ] TBD

## Documentation Updates
- [ ] TBD

## Review & Discussion
TBD — populated by /plan-review.
