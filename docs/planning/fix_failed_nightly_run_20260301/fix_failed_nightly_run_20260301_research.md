# Fix Failed Nightly Run Research

## Problem Statement
The nightly E2E test run has failed for 2 consecutive days (Feb 28 and Mar 1) after 3 days of passing. All 26 failures are @skip-prod tagged AI suggestions tests that are running against the production URL but should either be skipped or the production environment no longer supports them. Additionally, 2 home-tabs search tests are flaky on Chromium (search button stays disabled). The root cause needs investigation — either the nightly workflow isn't filtering @skip-prod tests, the production deployment changed, or the tests themselves need updating.

## Requirements (from GH Issue #NNN)
1. Investigate why 26 @skip-prod AI suggestions tests are not being skipped in the nightly workflow
2. Determine if @skip-prod filtering was recently removed or never existed in e2e-nightly.yml
3. Fix the nightly workflow to properly skip @skip-prod tests, OR fix the tests to work against production
4. Investigate the 2 flaky home-tabs search tests (search button disabled timeout)
5. Fix the flaky tests or add proper waits/retries
6. Verify the fix by triggering a manual nightly run
7. Update testing documentation if workflow behavior changes

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md

## Code Files Read
- [list of code files reviewed]
