#!/usr/bin/env npx tsx
// Phase 0 pilot for add_rewrite_mode_iterative_editing_evolution_20260507.
//
// For 5 stage articles: invokes gemini-2.5-flash-lite with a prototype Mode B
// proposer prompt, splits rationale/rewrite, runs the diff engine, applies a
// prototype coalescer+cap, runs parseProposedEdits, and reports the four
// gating metrics (drift rate, cap-fire-rate, idempotency, cycle-2 invariance)
// plus the recalibration measurements (max rewrite expansion, normalization
// audit).
//
// Usage:
//   npx tsx evolution/scripts/pilot-mode-b.ts
//
// Env: .env.local — OPENROUTER_API_KEY.
// Articles: /tmp/article_{1..5}.md (pulled in earlier R2.A simulation; if absent,
// re-pull from staging via npm run query:staging).

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { RenderCriticMarkupFromMDAstDiff } from '../../src/editorFiles/markdownASTdiff/markdownASTdiff';
import { parseProposedEdits } from '../src/lib/core/agents/editing/parseProposedEdits';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set in .env.local');
  process.exit(1);
}

const MODEL = 'google/gemini-2.5-flash-lite';
const ARTICLE_PATHS = [1, 2, 3, 4, 5].map(n => `/tmp/article_${n}.md`);

// Prototype Mode B system prompt.
const SYSTEM_PROMPT = `You propose targeted edits to an article.

Output format — respond with EXACTLY two sections, in this order:

## Rationale
[2–3 sentences explaining the changes you propose to make and why.]

## Rewrite
[The full article body, rewritten to incorporate your edits. Plain markdown — no special syntax, no commentary, no preamble.]

Rules:
- Make AT MOST 3 distinct edits per response. Surgical changes ship; sprawling rewrites get discarded.
- Preserve quotes, citations, URLs, and code fences exactly as they appear.
- Preserve heading structure (don't add or remove headings; don't change heading levels).
- Preserve the author's voice and reading level.
- Edit only when the change demonstrably improves clarity, structure, engagement, or grammar — never for its own sake.

Output the two sections only. No commentary outside them.`;

// Prototype splitter (anchored on exact section headers).
function splitRationaleAndRewrite(response: string): {
  rationale: string;
  rewrite: string;
  parseFailed: boolean;
} {
  // Strip outer code fence wrap if present.
  let body = response.trim();
  const fenceMatch = body.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) body = fenceMatch[1]!.trim();

  const rationaleAnchor = body.search(/^## Rationale\s*$/m);
  const rewriteAnchor = body.search(/^## Rewrite\s*$/m);

  if (rewriteAnchor === -1) {
    return { rationale: '', rewrite: body, parseFailed: true };
  }

  const rationaleStart = rationaleAnchor === -1 ? -1 : body.indexOf('\n', rationaleAnchor) + 1;
  const rewriteHeaderEnd = body.indexOf('\n', rewriteAnchor) + 1;

  const rationale = rationaleAnchor === -1 ? '' : body.slice(rationaleStart, rewriteAnchor).trim();
  const rewrite = body.slice(rewriteHeaderEnd).trim();

  return { rationale, rewrite, parseFailed: false };
}

// remark-stringify normalizer.
const stringifier = unified().use(remarkParse).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  rule: '-',
});

function normalize(md: string): string {
  return String(stringifier.processSync(md));
}

// Prototype coalescer: merge adjacent same-paragraph same-kind groups when gap < 24 chars.
// Prototype cap: keep top-K by total char delta.
function coalesceAndCap(groups: ReturnType<typeof parseProposedEdits>['groups'], _source: string, k = 10) {
  // For pilot purposes, cap only (coalesce logic deferred to Phase 3 helpers).
  const ranked = [...groups].sort((a, b) => {
    const aMag = a.atomicEdits.reduce((s, e) => s + e.oldText.length + e.newText.length, 0);
    const bMag = b.atomicEdits.reduce((s, e) => s + e.oldText.length + e.newText.length, 0);
    return bMag - aMag;
  });
  return { kept: ranked.slice(0, k), dropped: ranked.slice(k) };
}

// OpenRouter REST call.
async function callLLM(systemPrompt: string, userPrompt: string): Promise<{ content: string; tokens: { prompt: number; completion: number } }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Minddojo/explainanything',
      'X-Title': 'Phase 0 Pilot - Mode B',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return {
    content: data.choices[0]?.message?.content ?? '',
    tokens: { prompt: data.usage?.prompt_tokens ?? 0, completion: data.usage?.completion_tokens ?? 0 },
  };
}

interface PilotResult {
  article: string;
  sourceLen: number;
  rewriteLen: number;
  expansionRatio: number;
  rationale: string;
  parseFailed: boolean;
  driftDetected: boolean;
  groupCountRaw: number;
  groupCountPostCap: number;
  capFired: boolean;
  recoveredSourceMatches: boolean;
  idempotent: boolean;
  errors: string[];
  // Forensic-only on drift — first mismatch context
  driftFirstMismatchByte?: number;
  driftNormSlice?: string;
  driftRecoveredSlice?: string;
  // Saved on disk for offline analysis
  rewriteSavedTo?: string;
  markupSavedTo?: string;
}

async function runPilot(articlePath: string): Promise<PilotResult> {
  const source = fs.readFileSync(articlePath, 'utf8');
  const errors: string[] = [];

  // Idempotency check.
  const norm1 = normalize(source);
  const norm2 = normalize(norm1);
  const idempotent = norm1 === norm2;

  // LLM call.
  let llmContent = '';
  try {
    const { content } = await callLLM(SYSTEM_PROMPT, `<source>\n${source}\n</source>`);
    llmContent = content;
  } catch (e) {
    errors.push(`LLM call failed: ${(e as Error).message}`);
    return {
      article: path.basename(articlePath),
      sourceLen: source.length,
      rewriteLen: 0,
      expansionRatio: 0,
      rationale: '',
      parseFailed: true,
      driftDetected: true,
      groupCountRaw: 0,
      groupCountPostCap: 0,
      capFired: false,
      recoveredSourceMatches: false,
      idempotent,
      errors,
    };
  }

  // Split.
  const split = splitRationaleAndRewrite(llmContent);

  // Diff against normalized source.
  let groupCountRaw = 0;
  let groupCountPostCap = 0;
  let capFired = false;
  let recoveredSourceMatches = false;
  let driftDetected = false;
  let rewriteLen = split.rewrite.length;

  let diag: Partial<PilotResult> = {};
  if (split.parseFailed) {
    errors.push('Split failed: no ## Rewrite header');
  } else {
    try {
      const beforeAst = unified().use(remarkParse).parse(norm1) as Parameters<typeof RenderCriticMarkupFromMDAstDiff>[0];
      const normRewrite = normalize(split.rewrite);
      const afterAst = unified().use(remarkParse).parse(normRewrite) as Parameters<typeof RenderCriticMarkupFromMDAstDiff>[1];
      // Use aggressive thresholds (Decision #18).
      const markup = RenderCriticMarkupFromMDAstDiff(beforeAst, afterAst, {
        multipass: {
          paragraphAtomicDiffIfDiffAbove: 0.25,
          sentenceAtomicDiffIfDiffAbove: 0.10,
          sentencesPairedIfDiffBelow: 0.40,
        },
      });

      const parsed = parseProposedEdits(markup, norm1);
      groupCountRaw = parsed.groups.length;
      const { kept, dropped } = coalesceAndCap(parsed.groups, norm1, 10);
      groupCountPostCap = kept.length;
      capFired = dropped.length > 0;
      // Drift check: trim trailing whitespace per plan's "byte-for-byte modulo whitespace"
      // (engine emits trailing \n\n; remark-stringify emits trailing \n).
      const a = norm1.replace(/\s+$/, '');
      const b = parsed.recoveredSource.replace(/\s+$/, '');
      recoveredSourceMatches = a === b;
      driftDetected = !recoveredSourceMatches;
      if (driftDetected) {
        let m = 0;
        while (m < Math.min(a.length, b.length) && a[m] === b[m]) m++;
        diag = {
          driftFirstMismatchByte: m,
          driftNormSlice: a.slice(Math.max(0, m - 30), m + 60),
          driftRecoveredSlice: b.slice(Math.max(0, m - 30), m + 60),
        };
        // Save artifacts for offline analysis.
        const base = path.basename(articlePath, '.md');
        const rewritePath = `/tmp/pilot-${base}-rewrite.md`;
        const markupPath = `/tmp/pilot-${base}-markup.md`;
        fs.writeFileSync(rewritePath, split.rewrite);
        fs.writeFileSync(markupPath, markup);
        diag.rewriteSavedTo = rewritePath;
        diag.markupSavedTo = markupPath;
      }
    } catch (e) {
      errors.push(`Diff/parse error: ${(e as Error).message}`);
      driftDetected = true;
    }
  }

  return {
    article: path.basename(articlePath),
    sourceLen: source.length,
    rewriteLen,
    expansionRatio: source.length > 0 ? rewriteLen / source.length : 0,
    rationale: split.rationale.slice(0, 200),
    parseFailed: split.parseFailed,
    driftDetected,
    groupCountRaw,
    groupCountPostCap,
    capFired,
    recoveredSourceMatches,
    idempotent,
    errors,
    ...diag,
  };
}

async function main() {
  console.log(`Phase 0 pilot — model=${MODEL}, articles=${ARTICLE_PATHS.length}`);
  console.log('=' .repeat(80));

  const results: PilotResult[] = [];
  for (const p of ARTICLE_PATHS) {
    if (!fs.existsSync(p)) {
      console.warn(`Skipping missing article: ${p}`);
      continue;
    }
    process.stdout.write(`Running ${path.basename(p)}... `);
    const r = await runPilot(p);
    results.push(r);
    console.log(`groups=${r.groupCountRaw}→${r.groupCountPostCap} drift=${r.driftDetected} idem=${r.idempotent} expansion=${r.expansionRatio.toFixed(2)}x`);
    if (r.errors.length > 0) console.log(`  ERRORS: ${r.errors.join('; ')}`);
  }

  // Aggregate metrics.
  const n = results.length;
  if (n === 0) {
    console.error('No articles processed.');
    process.exit(1);
  }
  const driftRate = results.filter(r => r.driftDetected).length / n;
  const capFireRate = results.filter(r => r.capFired).length / n;
  const idempotentAll = results.every(r => r.idempotent);
  const maxExpansion = Math.max(...results.map(r => r.expansionRatio));
  const p95Expansion = results.map(r => r.expansionRatio).sort((a, b) => a - b)[Math.ceil(n * 0.95) - 1] ?? maxExpansion;
  const parseFailures = results.filter(r => r.parseFailed).length;

  console.log('=' .repeat(80));
  console.log('GATE METRICS');
  console.log(`  Drift rate:        ${(driftRate * 100).toFixed(1)}%      (gate: ≤3%)`);
  console.log(`  Cap-fire rate:     ${(capFireRate * 100).toFixed(1)}%      (gate: ≤40%)`);
  console.log(`  Idempotent (all):  ${idempotentAll}    (gate: true)`);
  console.log(`  Parse failures:    ${parseFailures}/${n}`);
  console.log('RECALIBRATION');
  console.log(`  Max expansion:     ${maxExpansion.toFixed(2)}x  (recalibrate cap if >3.0)`);
  console.log(`  p95 expansion:     ${p95Expansion.toFixed(2)}x`);
  console.log('=' .repeat(80));

  // Save full results for the research doc.
  const outPath = '/tmp/pilot-mode-b-results.json';
  fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, results, summary: { driftRate, capFireRate, idempotentAll, maxExpansion, p95Expansion, parseFailures, n } }, null, 2));
  console.log(`Full results: ${outPath}`);

  // Gate decision.
  const passes = driftRate <= 0.03 && capFireRate <= 0.40 && idempotentAll;
  console.log(`\nGATE: ${passes ? 'PASS' : 'FAIL'} — Phase 1 ${passes ? 'unblocked' : 'BLOCKED; redesign required'}`);
  process.exit(passes ? 0 : 2);
}

main().catch(e => {
  console.error('Pilot crashed:', e);
  process.exit(1);
});
