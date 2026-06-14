// Runs the Phase-1 offline ensemble analysis on the pinned fixture and prints a leaderboard:
// single-judge baselines + the candidate escalation chains under first_decisive vs
// unanimous_among_decisive, per mode. Produces the acceptance-gate numbers (no DB/LLM).
//   npx tsx evolution/scripts/runJudgeEnsembleOffline.ts

import recordedCorpus from '../src/lib/shared/judgeEnsemble/fixtures/recordedCorpus.json';
import { firstDecisive, unanimousAmongDecisive } from '../src/lib/shared/judgeEnsemble/aggregation';
import {
  analyzeChain,
  ARTICLE_SET,
  PARAGRAPH_SET,
  type ChainMetrics,
  type RecordedCall,
} from '../src/lib/shared/judgeEnsemble/offlineReaggregate';

const corpus = recordedCorpus as RecordedCall[];
const filt = (set: string, kind: 'article' | 'paragraph'): RecordedCall[] =>
  corpus.filter((r) => r.testSet === set && r.pairKind === kind);

const pct = (x: number | null): string => (x == null ? '   -  ' : x.toFixed(3));
function row(label: string, m: ChainMetrics): string {
  return [
    label.padEnd(46),
    `n=${String(m.nPairs).padStart(3)}`,
    `dec=${pct(m.decisiveRate)}`,
    `acc=${pct(m.accuracyLargeGap)}`,
    `loneWrong=${pct(m.loneDecisiveWrongRate)}`,
    `$/dec=${m.costPerDecisive.toFixed(5)}`,
    `depth=${m.avgDepth.toFixed(2)}`,
    `nLG=${m.nLargeGap}`,
  ].join('  ');
}

function section(
  title: string,
  calls: RecordedCall[],
  baselineModels: string[],
  chains: Record<string, string[]>,
): void {
  console.log(`\n=== ${title} ===`);
  console.log('-- single-judge baselines (first_decisive, chain-of-1) --');
  for (const model of baselineModels) {
    console.log(row(`  ${model}`, analyzeChain(calls, [model], firstDecisive)));
  }
  console.log('-- escalation chains --');
  for (const [name, chain] of Object.entries(chains)) {
    console.log(row(`  ${name}  [first_decisive]`, analyzeChain(calls, chain, firstDecisive)));
    console.log(row(`  ${name}  [unanimous>=2]`, analyzeChain(calls, chain, unanimousAmongDecisive)));
  }
}

section(
  'ARTICLES (set 9acb42f5)',
  filt(ARTICLE_SET, 'article'),
  ['deepseek-chat', 'gpt-4o-mini', 'gpt-4.1'],
  {
    'A1 chat->4o-mini->4.1': ['deepseek-chat', 'gpt-4o-mini', 'gpt-4.1'],
    'A2 4o-mini->chat->4.1': ['gpt-4o-mini', 'deepseek-chat', 'gpt-4.1'],
    'A3 4o-mini->chat (cheap only)': ['gpt-4o-mini', 'deepseek-chat'],
  },
);
section(
  'PARAGRAPHS (set 970494a4)',
  filt(PARAGRAPH_SET, 'paragraph'),
  ['deepseek-v4-flash', 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash', 'deepseek-v4-pro'],
  {
    'P1 flash->lite->pro (current)': ['deepseek-v4-flash', 'google/gemini-2.5-flash-lite', 'deepseek-v4-pro'],
    'P2 lite->flash (cheap, acc-first)': ['google/gemini-2.5-flash-lite', 'deepseek-v4-flash'],
    'P3 lite->flash->gemini-flash': ['google/gemini-2.5-flash-lite', 'deepseek-v4-flash', 'google/gemini-2.5-flash'],
  },
);
console.log('');
