// Offline chain-composition explorer (Phase 5): replays the pinned corpus through every ordering of
// the recorded CHEAP judges (subset size 1..3) per mode and ranks by the acceptance-gate metrics, to
// find the most accurate-yet-decisive composition. No LLM/DB. Run: npx tsx evolution/scripts/chain-composition-explore.ts

import corpusJson from '../src/lib/shared/judgeEnsemble/fixtures/recordedCorpus.json';
import { firstDecisive } from '../src/lib/shared/judgeEnsemble/aggregation';
import { analyzeChain, type RecordedCall, type ChainMetrics } from '../src/lib/shared/judgeEnsemble/offlineReaggregate';

const corpus = corpusJson as RecordedCall[];

// Cheap judges only (the chain is a cheap-ensemble; strong judges are the accuracy reference, not chain members).
const CHEAP: Record<'article' | 'paragraph', string[]> = {
  article: ['gpt-4o-mini', 'deepseek-chat', 'deepseek-v4-flash', 'gpt-4.1-nano'],
  paragraph: ['google/gemini-2.5-flash-lite', 'deepseek-v4-flash', 'google/gemini-2.5-flash', 'deepseek-v4-pro'],
};

function permutationsUpTo(models: string[], maxLen: number): string[][] {
  const out: string[][] = [];
  const rec = (prefix: string[], rest: string[]): void => {
    if (prefix.length >= 1) out.push([...prefix]);
    if (prefix.length === maxLen) return;
    for (let i = 0; i < rest.length; i += 1) {
      rec([...prefix, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  rec([], models);
  return out;
}

const pct = (n: number | null): string => (n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`);

for (const mode of ['article', 'paragraph'] as const) {
  const calls = corpus.filter((c) => c.pairKind === mode);
  console.log(`\n══════ ${mode.toUpperCase()} — chain composition search (cap 3, first_decisive) ══════`);
  const candidates = permutationsUpTo(CHEAP[mode], 3).map((chain) => ({ chain, m: analyzeChain(calls, chain, firstDecisive) }));

  // Acceptance-gate-style filter: accuracy ≥ 90% AND lone-decisive-wrong ≤ 10%, then maximize decisiveness.
  const safe = candidates.filter(
    (c) => (c.m.accuracyLargeGap ?? 0) >= 0.9 && (c.m.loneDecisiveWrongRate ?? 1) <= 0.1,
  );
  safe.sort((a, b) => b.m.decisiveRate - a.m.decisiveRate);

  const fmt = (c: { chain: string[]; m: ChainMetrics }): string =>
    `dec ${pct(c.m.decisiveRate)}  acc ${pct(c.m.accuracyLargeGap)}  loneWrong ${pct(c.m.loneDecisiveWrongRate)}  $/dec ${c.m.costPerDecisive.toFixed(5)}  depth ${c.m.avgDepth.toFixed(2)}  [${c.chain.join(' -> ')}]`;

  if (safe.length === 0) {
    console.log('  ✗ NO composition clears accuracy ≥90% AND lone-wrong ≤10%. Top by decisiveness (unsafe):');
    candidates.sort((a, b) => b.m.decisiveRate - a.m.decisiveRate);
    candidates.slice(0, 5).forEach((c) => console.log(`    ${fmt(c)}`));
  } else {
    console.log(`  ✓ ${safe.length} safe composition(s) clear the guard. Best (most decisive):`);
    safe.slice(0, 5).forEach((c) => console.log(`    ${fmt(c)}`));
  }
}
