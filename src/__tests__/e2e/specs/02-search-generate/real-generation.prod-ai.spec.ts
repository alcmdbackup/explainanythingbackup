// Deliberate cheap real-AI smoke (reduce_e2e_openai_test_costs_20260607).
// Runs ONLY in the `prod-ai` Playwright project against the port-3010 server, which runs the
// REAL returnExplanation pipeline (no E2E_TEST_MODE) on a cheap model (TEST_LLM_MODEL=
// google/gemini-2.5-flash). Asserts the FULL pipeline executed — title, content, and tags —
// so a prompt/contract regression in any ancillary real LLM call surfaces nightly. Assertions
// are structural (non-empty / present), NOT exact text, so real-LLM non-determinism + the
// project's 2 retries don't false-red without masking a genuine pipeline break.

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { trackExplanationForCleanup, cleanupAllTrackedExplanations } from '../../helpers/test-data-factory';

test.describe('Real generation (prod-ai cheap real-AI smoke)', () => {
  test.afterAll(async () => {
    await cleanupAllTrackedExplanations();
  });

  test('full pipeline produces title, content, and tags via real LLM', { tag: '@prod-ai' }, async ({ authenticatedPage: page }) => {
    // Real generation against a live model (full pipeline) legitimately exceeds 60s; this is a
    // deliberate real-AI smoke, not a mocked test.
    // eslint-disable-next-line flakiness/max-test-timeout -- real LLM generation latency
    test.setTimeout(120000);
    const resultsPage = new ResultsPage(page);

    // Drive a real generation (no mock on port 3010). Use a [TEST]-prefixed query so any
    // generated/persisted content is discovery-filtered and prefix-cleanable.
    await resultsPage.navigate('[TEST] Explain how photosynthesis works');
    await resultsPage.waitForStreamingComplete(90000);

    // Capture the persisted explanation id from the post-stream redirect and track for cleanup.
    const explanationId = new URL(page.url()).searchParams.get('explanation_id');
    if (explanationId) trackExplanationForCleanup(explanationId);

    // FULL-PIPELINE structural assertions — each proves a distinct real LLM call site executed.
    const title = await resultsPage.getTitle();
    expect(title.trim().length).toBeGreaterThan(0); // generateTitleFromUserQuery

    const hasContent = await resultsPage.hasContent();
    expect(hasContent).toBe(true);                  // generateNewExplanation (streamed)

    const tags = await resultsPage.getTags();
    expect(tags.length).toBeGreaterThan(0);         // evaluateTags
  });
});
