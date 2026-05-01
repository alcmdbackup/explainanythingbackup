# Develop Reflection and GenerateFromParentArticle Agent Evolution Plan

## Background
I want to create a new agent type called "reflection and generate from Parent"

## Requirements (from GH Issue #NNN)
- Overview
    - This will be a new agent type
    - This will add a new reflection step in from of generateFromPreviousArticle
    - Please extend our existing agent code to make this code as much as possible
    - Re-use existing generateFromPreviousArticle in a modular way as much as possible
- Prompt
    - Read the existing parent
    - Pass in existing list of tactics, a brief summary of each, and the relative elo boosts of each based on performance data
        - Randomize the order with which tactics are passed in to prevent positional bias
    - Pick the best tactic to apply
- Pick the best tactic to use
    - Configurable input for # of tactics to try to apply
- Then call generateFromPreviousArticle

How should this work?

- All of this will be one agent, called reflectAndGenerateFromPreviousArticle
- Lightly modify same re-usable components for invocation details - see below for details

Existing details overview

- Reflection Overview - separate tab for reflection portion
- GenerateFromPreviousArticle Overview - re-use the existing tab for generateFromPreviousArticle
- Metrics - no change, only generateFromPreviousArticle produces metrics anyway
- Timeline - show additional calls used by reflection
- Logs - show logs from both

## Problem
[3-5 sentences describing the problem]

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item with specific deliverable]

### Phase 2: [Phase Name]
- [ ] [Actionable item with specific deliverable]

## Testing

### Unit Tests
- [ ] [Test file path and description]

### Integration Tests
- [ ] [Test file path and description]

### E2E Tests
- [ ] [Test file path and description]

### Manual Verification
- [ ] [Manual verification step]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check]

### B) Automated Tests
- [ ] [Specific test file path or command to run]

## Documentation Updates
- [ ] [Doc path — brief note on what may change]

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
