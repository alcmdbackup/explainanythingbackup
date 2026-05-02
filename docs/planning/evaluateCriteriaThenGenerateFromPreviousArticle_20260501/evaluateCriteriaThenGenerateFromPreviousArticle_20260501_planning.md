# evaluateCriteriaThenGenerateFromPreviousArticle Plan

## Background

**EvaluateCriteriaThenGenerateFromPreviousArticle**

- Architecture
    - Look at how reflectAndGenerateFromPreviousArticle works
- "Criteria"
    - New top-level entity called criteria, pattern it on "tactics" of setup (including list view in evolution admin panel side nav, etc)
    - What it includes
        - Criteria name
        - Description - what it should be evaluating for specifically
        - Min rating (number)
        - Max rating (number)
- Prompt
    - Prompt 1
        - Read the existing parent
        - List of criteria to evaluate on and rating range
        - Rating for each criteria
    - Prompt 2
        - Focus on the criteria(s) that are the weakest
        - Return examples of what needs to be addressed, and suggestions of how to fix it.
        - Return this in a structured form of a list
- Strategy configuration
    - Pass in the list of criteria to evaluate
- Generation impact
    - Use evaluation and examples to generate new version
    - This replaces the "tactic" structurally
    - Figure out how to refactor to make this work

## Requirements (from GH Issue #NNN)

**EvaluateCriteriaThenGenerateFromPreviousArticle**

- Architecture
    - Look at how reflectAndGenerateFromPreviousArticle works
- "Criteria"
    - New top-level entity called criteria, pattern it on "tactics" of setup (including list view in evolution admin panel side nav, etc)
    - What it includes
        - Criteria name
        - Description - what it should be evaluating for specifically
        - Min rating (number)
        - Max rating (number)
- Prompt
    - Prompt 1
        - Read the existing parent
        - List of criteria to evaluate on and rating range
        - Rating for each criteria
    - Prompt 2
        - Focus on the criteria(s) that are the weakest
        - Return examples of what needs to be addressed, and suggestions of how to fix it.
        - Return this in a structured form of a list
- Strategy configuration
    - Pass in the list of criteria to evaluate
- Generation impact
    - Use evaluation and examples to generate new version
    - This replaces the "tactic" structurally
    - Figure out how to refactor to make this work

## Problem

_To be populated during planning._

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

_Populated by /plan-review with agent scores, reasoning, and gap resolutions._
