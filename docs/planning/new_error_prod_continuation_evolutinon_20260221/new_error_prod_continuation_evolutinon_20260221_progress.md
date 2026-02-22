# New Error Prod Continuation Evolution Progress

## Phase 1: Research & Fix
### Work Done
- Identified root cause: PostgreSQL function overload ambiguity in `claim_evolution_run`
- Migration `20260221000002` recreated 1-arg version but left orphaned 2-arg version from `20260221000001`
- PostgREST cannot disambiguate between `f(text)` and `f(text, uuid DEFAULT NULL)` when called with 1 arg

### Issues Encountered
- None yet

### User Clarifications
- User confirmed fix approach: drop both overloads, recreate single 2-arg version
