# Minor Cleanup Progress

## Phase 1: Remove Queue for Evolution Button
### Work Done
- Removed `QueueDialog` component (legacy flow using raw explanationId + budget)
- Removed `showQueueDialog` state, `handleQueue` function, button JSX, and dialog render
- Kept `queueEvolutionRunAction` import (still used by `StartRunCard`)
- Verified: lint passes, tsc passes, no tests reference removed code

### Issues Encountered
None — clean removal with no dependencies.

### User Clarifications
None needed.
