#!/usr/bin/env npx tsx
import * as fs from 'fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { RenderCriticMarkupFromMDAstDiff } from '../../src/editorFiles/markdownASTdiff/markdownASTdiff';
import { parseProposedEdits } from '../src/lib/core/agents/editing/parseProposedEdits';

const origLog = console.log;
console.log = () => {};

const stringifier = unified().use(remarkParse).use(remarkStringify, {
  bullet: '-', emphasis: '*', strong: '*', fences: true, rule: '-',
});
function normalize(md: string): string { return String(stringifier.processSync(md)); }

const source = fs.readFileSync('/tmp/article_1.md', 'utf8');
// Make a synthetic small edit to drive the engine.
const rewriteRaw = source.replace('Federal Reserve', 'Fed');

const norm = normalize(source);
const normRewrite = normalize(rewriteRaw);

const ast1 = unified().use(remarkParse).parse(norm) as Parameters<typeof RenderCriticMarkupFromMDAstDiff>[0];
const ast2 = unified().use(remarkParse).parse(normRewrite) as Parameters<typeof RenderCriticMarkupFromMDAstDiff>[1];
const markup = RenderCriticMarkupFromMDAstDiff(ast1, ast2, {
  multipass: { paragraphAtomicDiffIfDiffAbove: 0.25, sentenceAtomicDiffIfDiffAbove: 0.10, sentencesPairedIfDiffBelow: 0.40 },
});

const parsed = parseProposedEdits(markup, norm);
console.log = origLog;

console.log(`norm.length:                    ${norm.length}`);
console.log(`markup.length:                  ${markup.length}`);
console.log(`parsed.recoveredSource.length:  ${parsed.recoveredSource.length}`);
console.log(`recoveredSource === norm:       ${parsed.recoveredSource === norm}`);
console.log(`groups: ${parsed.groups.length}`);
console.log();

// Find first mismatch markup vs norm
const a = norm;
let j = 0;
while (j < Math.min(a.length, markup.length) && a[j] === markup[j]) j++;
console.log(`MARKUP vs NORM first mismatch at byte ${j}/${a.length}:`);
console.log(`  norm  : ${JSON.stringify(a.slice(Math.max(0,j-40), j+60))}`);
console.log(`  markup: ${JSON.stringify(markup.slice(Math.max(0,j-40), j+60))}`);
console.log();

const b = parsed.recoveredSource;
let i = 0;
while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
console.log(`RECOVERED vs NORM first mismatch at byte ${i}/${a.length}:`);
console.log(`  norm     : ${JSON.stringify(a.slice(Math.max(0,i-40), i+60))}`);
console.log(`  recovered: ${JSON.stringify(b.slice(Math.max(0,i-40), i+60))}`);
console.log();
console.log(`Markup full (first 300 chars):`);
console.log(JSON.stringify(markup.slice(0, 300)));
console.log();
console.log(`Markup around the substitution close:`);
const closeIdx = markup.indexOf('~~}');
console.log(JSON.stringify(markup.slice(Math.max(0, closeIdx - 30), closeIdx + 80)));
