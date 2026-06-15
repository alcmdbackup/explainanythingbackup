// Prints the Phase-1 acceptance-gate table from the pinned recorded corpus (offline, no LLM/DB):
// per-mode single-judge baselines + the finalized escalation chain, with the 4 gate verdicts and the
// large-gap n (power). Run: npx tsx evolution/scripts/acceptance-gate-report.ts

import corpusJson from '../src/lib/shared/judgeEnsemble/fixtures/recordedCorpus.json';
import { firstDecisive } from '../src/lib/shared/judgeEnsemble/aggregation';
import { analyzeChain, CHAINS, type RecordedCall, type ChainMetrics } from '../src/lib/shared/judgeEnsemble/offlineReaggregate';

const corpus = corpusJson as RecordedCall[];

function modelsIn(calls: RecordedCall[]): string[] {
  return [...new Set(calls.map((c) => c.model))];
}

function pct(n: number | null): string {
  return n == null ? '  n/a' : `${(n * 100).toFixed(1)}%`;
}

function row(label: string, m: ChainMetrics): string {
  return [
    label.padEnd(46),
    `dec ${pct(m.decisiveRate)}`.padEnd(11),
    `acc ${pct(m.accuracyLargeGap)}`.padEnd(11),
    `loneWrong ${pct(m.loneDecisiveWrongRate)}`.padEnd(20),
    `$/dec ${m.costPerDecisive.toFixed(5)}`.padEnd(15),
    `depth ${m.avgDepth.toFixed(2)}`.padEnd(12),
    `nLargeGap ${m.nLargeGap}`,
  ].join(' ');
}

for (const mode of ['article', 'paragraph'] as const) {
  const calls = corpus.filter((c) => c.pairKind === mode);
  const chain = CHAINS[mode];
  console.log(`\n══════ ${mode.toUpperCase()} (${calls.length} recorded calls) ══════`);

  // Single-judge baselines (each model alone = chain-of-1).
  const singles = modelsIn(calls).map((model) => ({ model, m: analyzeChain(calls, [model], firstDecisive) }));
  singles.sort((a, b) => b.m.decisiveRate - a.m.decisiveRate);
  for (const s of singles) console.log(row(`  single: ${s.model}`, s.m));

  // The finalized chain.
  const chainM = analyzeChain(calls, chain, firstDecisive);
  console.log(row(`  CHAIN: [${chain.join(' -> ')}]`, chainM));

  // Gate comparators (per the plan):
  //  - uplift   : vs the best single CHEAP judge = the chain's own constituent models run alone.
  //  - accuracy : vs the STRONG judge = the single with the highest large-gap accuracy (tiebreak decisive).
  //  - cost     : vs that same STRONG judge's cost_per_decisive.
  const cheapSingles = singles.filter((s) => chain.includes(s.model));
  const bestSingleCheap = cheapSingles.length ? Math.max(...cheapSingles.map((s) => s.m.decisiveRate)) : 0;
  const accSingles = singles.filter((s) => s.m.accuracyLargeGap != null);
  const strong = accSingles.slice().sort((a, b) =>
    (b.m.accuracyLargeGap as number) - (a.m.accuracyLargeGap as number) || b.m.decisiveRate - a.m.decisiveRate,
  )[0];

  const upliftOk = chainM.decisiveRate >= bestSingleCheap + 0.1;
  const accOk = strong == null || chainM.accuracyLargeGap == null ? null : chainM.accuracyLargeGap >= (strong.m.accuracyLargeGap as number) - 0.03;
  const loneOk = chainM.loneDecisiveWrongRate == null ? null : chainM.loneDecisiveWrongRate <= 0.1;
  const costOk = strong == null ? null : chainM.costPerDecisive <= strong.m.costPerDecisive;

  const v = (b: boolean | null): string => (b == null ? '⊘ (n/a)' : b ? '✓ PASS' : '✗ FAIL');
  console.log(`  GATE  (strong judge = ${strong?.model ?? 'n/a'}):`);
  console.log(`    decisiveness uplift ≥0.10  : ${v(upliftOk)}  (chain ${pct(chainM.decisiveRate)} vs best-cheap ${pct(bestSingleCheap)})`);
  console.log(`    large-gap accuracy guard   : ${v(accOk)}  (chain ${pct(chainM.accuracyLargeGap)} vs strong ${pct(strong?.m.accuracyLargeGap ?? null)})`);
  console.log(`    lone-decisive-wrong ≤0.10  : ${v(loneOk)}  (chain ${pct(chainM.loneDecisiveWrongRate)})  [n_large=${chainM.nLargeGap} — POWER]`);
  console.log(`    cost/decisive ≤ strong     : ${v(costOk)}  (chain $${chainM.costPerDecisive.toFixed(5)} vs strong $${strong?.m.costPerDecisive.toFixed(5) ?? 'n/a'})`);
}
console.log('\nNote: the lone-decisive-safety bar is only meaningful at adequate n_large (target ≥50/mode).');
