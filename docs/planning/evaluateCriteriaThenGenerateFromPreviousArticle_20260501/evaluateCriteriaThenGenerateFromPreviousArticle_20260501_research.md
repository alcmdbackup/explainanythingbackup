# evaluateCriteriaThenGenerateFromPreviousArticle Research

## Problem Statement

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

## High Level Summary

_To be populated by /research._

## Documents Read

_To be populated by /research._

## Code Files Read

_To be populated by /research._
