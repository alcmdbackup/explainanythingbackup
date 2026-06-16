// One-off: build two frozen LARGE-GAP-only test sets (article + paragraph, 60 each) from the
// "Federal Reserve 2" pair bank, for a properly-powered (n≥50) acceptance-gate measurement.
// Run: npx tsx evolution/scripts/build-gate-testsets.ts

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
for (const c of ['.env.local', '.env']) {
  const p = path.resolve(process.cwd(), c);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { loadPairBankByName, getOrCreateTestSet } from '@evolution/lib/judgeEval/persist';

const BANK = 'Federal Reserve 2';
const N = Number(process.argv[2] ?? 60);
const SUFFIX = process.argv[3] ?? `lg${N}`;

async function main(): Promise<void> {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const bank = await loadPairBankByName(db as never, BANK);
  if (!bank) throw new Error(`bank not found: ${BANK}`);
  const pairs = bank.pairs as Array<{ label: string; pair_kind: string; gap_kind: string }>;

  const pick = (kind: string): string[] =>
    pairs.filter((p) => p.pair_kind === kind && p.gap_kind === 'large').slice(0, N).map((p) => p.label);

  const articleLabels = pick('article');
  const paragraphLabels = pick('paragraph');
  console.log(`large-gap available → article ${pairs.filter((p) => p.pair_kind === 'article' && p.gap_kind === 'large').length}, paragraph ${pairs.filter((p) => p.pair_kind === 'paragraph' && p.gap_kind === 'large').length}`);
  console.log(`selecting ${articleLabels.length} article + ${paragraphLabels.length} paragraph labels`);

  const a = await getOrCreateTestSet(db as never, bank, {
    name: `gate-article-${SUFFIX}`, strategy: 'manual', seed: 1, sizeArticle: articleLabels.length, sizeParagraph: 0, manualLabels: articleLabels,
  });
  console.log(`article set ${a.created ? 'CREATED' : 'exists'}: ${a.testSet.id} (${a.testSet.size_article} pairs)`);

  const p = await getOrCreateTestSet(db as never, bank, {
    name: `gate-paragraph-${SUFFIX}`, strategy: 'manual', seed: 1, sizeArticle: 0, sizeParagraph: paragraphLabels.length, manualLabels: paragraphLabels,
  });
  console.log(`paragraph set ${p.created ? 'CREATED' : 'exists'}: ${p.testSet.id} (${p.testSet.size_paragraph} pairs)`);
}

main().catch((e) => {
  console.error('ERR', e instanceof Error ? e.message : e);
  process.exit(1);
});
