// Maps a `call_source` to its spending-dashboard dimensions (entity + evolution/non_evolution
// category) and classifies test/mock rows. Single source of truth for cost attribution
// (Layer 3); the entity map is exhaustive over CALL_SOURCES (enforced by unit test).
// See docs/planning/build_llm_spending_tab_in_admin_dash_20260620/.

import { CALL_SOURCES } from '@/lib/services/llmCallSource';

export type CostCategory = 'evolution' | 'non_evolution';
export interface CallAttribution {
  entity: string;
  category: CostCategory;
}

/** Human entity label per registry source. MUST cover every CALL_SOURCES value
 *  (asserted by the exhaustiveness test in llmCostAttribution.test.ts). */
const ENTITY_BY_SOURCE: Record<string, string> = {
  [CALL_SOURCES.generateTitleFromUserQuery]: 'Title generation',
  [CALL_SOURCES.extractLinkCandidates]: 'Link extraction',
  [CALL_SOURCES.generateNewExplanation]: 'Explanation generation',
  [CALL_SOURCES.evaluateTags]: 'Tag evaluation',
  [CALL_SOURCES.explanationSummarization]: 'Summaries',
  [CALL_SOURCES.sourceSummarization]: 'Source summaries',
  [CALL_SOURCES.findBestMatchFromList]: 'Match selection',
  [CALL_SOURCES.contentQualityEval]: 'Content quality eval',
  [CALL_SOURCES.contentQualityCompareScore]: 'Content quality compare',
  [CALL_SOURCES.contentQualityComparePair]: 'Content quality compare',
  [CALL_SOURCES.enhanceContentWithInlineLinks]: 'Inline links',
  [CALL_SOURCES.enhanceContentWithHeadingLinks]: 'Heading links',
  [CALL_SOURCES.generateHeadingStandaloneTitles]: 'Heading titles',
  [CALL_SOURCES.editorAiSuggestions]: 'Editor AI suggestions',
  [CALL_SOURCES.editorApplySuggestions]: 'Editor apply suggestions',
  [CALL_SOURCES.streamChatApi]: 'Chat',
  [CALL_SOURCES.importArticle]: 'Article import',
  [CALL_SOURCES.oneshot]: 'Oneshot generator',
  [CALL_SOURCES.oneshotOutline]: 'Oneshot outline',
  [CALL_SOURCES.pilotModeB]: 'Pilot (mode B)',
  [CALL_SOURCES.evolutionJudgeEval]: 'Evolution: judge eval',
  [CALL_SOURCES.evolutionPromptEditor]: 'Evolution: prompt editor',
  [CALL_SOURCES.evolutionWeightInference]: 'Evolution: weight inference',
  [CALL_SOURCES.evolutionStyleFingerprintExtraction]: 'Evolution: style fingerprint extraction',
  [CALL_SOURCES.matchViewerRejudge]: 'Arena rejudge',
};

/**
 * Resolve a call_source string (from the DB; not necessarily branded) to its dashboard
 * dimensions. `evolution_<agent>` collapses to one entity per agent; known non-evolution
 * sources use the mapped label; unattributed fallbacks and unknown sources degrade
 * gracefully (the source string itself, or 'Unattributed').
 */
export function attributeCallSource(callSource: string): CallAttribution {
  if (callSource.startsWith('unattributed:')) {
    return { entity: 'Unattributed', category: 'non_evolution' };
  }
  const category: CostCategory = callSource.startsWith('evolution_') ? 'evolution' : 'non_evolution';
  if (category === 'evolution') {
    const mapped = ENTITY_BY_SOURCE[callSource];
    return { entity: mapped ?? `Evolution: ${callSource.replace(/^evolution_/, '')}`, category };
  }
  return { entity: ENTITY_BY_SOURCE[callSource] ?? callSource, category };
}

/** Known system/test userids. NOTE (debug_llm_spending_data_issues_stage_20260621): these are NO
 *  LONGER used to classify `is_test`. `…000` (anonymous, oneshot/local-run) and `…001`
 *  (EVOLUTION_SYSTEM_USERID) are used by REAL evolution + offline-tool spend — tagging them test
 *  hid real spend. `is_test` is now driven by test RUNTIME, not userid (see isTestLlmCall). Kept
 *  for documentation / ad-hoc queries only. `…099` holds legacy fake $0.50/call pollution. */
export const TEST_USER_IDS = new Set<string>([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000099',
]);

/**
 * Is this tracking row test/mock pollution rather than REAL operational spend?
 *
 * `is_test` means "NOT real operational spend" — driven by test RUNTIME / mock signals, NOT by
 * userid. A real offline tool (oneshot, judge lab) or a real evolution run uses a system userid
 * (`…000`/`…001`) but spends real money, so it must count toward reconciliation (is_test=false).
 * Conversely the `prod-ai` E2E harness runs the REAL pipeline (no NODE_ENV=test, no E2E_TEST_MODE)
 * under the SAME `…001` userid, so it needs an explicit runtime flag (`LLM_TRACKING_TEST_RUNTIME`)
 * to be tagged test — userid cannot discriminate it from a real evolution run.
 *
 * The `content === 'Unexpected call'` mock fingerprint is best-effort; a real response equal to
 * that string is a (harmless, rare) false positive.
 */
export function isTestLlmCall(args: { userid: string; callSource: string; content: string }): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.E2E_TEST_MODE === 'true' ||
    process.env.LLM_TRACKING_TEST_RUNTIME === 'true' || // prod-ai harness (real pipeline, test purpose)
    args.callSource === 'integration_test' ||
    args.callSource === 'generation' || // evolution-test-data-factory literal
    args.content === 'Unexpected call' // mock fixture fingerprint (best-effort)
  );
}
