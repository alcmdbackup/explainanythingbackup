// Phase 4 (evalute_implied_rubric_results_and_experimentally_validate_20260623) — cross-arm
// comparison of weight-inference sessions on the same Judge Lab test set. Same shape as the
// baseline `_wi_consistency_analysis.ts` one-off, but generalized to 2-4 arms and with:
//
//   - Hash-verify each arm's persisted holistic_prompt_override against
//     ACCEPTED_HASHES[arm] in experimentArms.ts (defense against operator typo/paste drift).
//   - Hash-verify the resolved pair set per session against the cross-arm canonical set
//     (defense against the test set mutating mid-experiment).
//   - Stable JSON output (sorted keys, fixed arm order) so re-running on identical data
//     produces byte-identical output.
//
// Usage:
//   npx tsx evolution/scripts/wi_arm_comparison.ts --staging \
//     --test-set 9acb42f5-fa9b-4ce8-b053-431fbe01e026 \
//     --arm-a 20a09cde-883c-4919-8bda-24ae74986ca8 \
//     --arm-b <sessionId> --arm-c <sessionId> [--arm-d <sessionId>] \
//     --out docs/analysis/wi_holistic_prompt_priming/wi_arm_comparison_results.json
//
// Read-only — no DB writes. Targets staging by default; pass --prod to hit production.

import { Client } from 'pg';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  fitWeights,
  weightCIs,
  type PairObservation,
  type Verdict3,
} from '@evolution/lib/weightInference';
import {
  ARM_A_CANONICAL_RUBRIC_BLOCK,
  EXPERIMENT_ARMS,
  type ArmKey,
} from '@evolution/lib/weightInference/experimentArms';
import {
  ACCEPTED_HASHES,
  sha256Hex,
  verifyArmHash,
} from '@evolution/lib/weightInference/experimentArmsHashing';

dns.setDefaultResultOrder('ipv4first');

// ─── CLI parsing ──────────────────────────────────────────────────────

interface Args {
  target: 'staging' | 'prod';
  testSetId: string;
  armSessions: Partial<Record<ArmKey, string>>;
  outPath: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const out: Args = {
    target: 'staging',
    testSetId: '',
    armSessions: {},
    outPath: 'docs/analysis/wi_holistic_prompt_priming/wi_arm_comparison_results.json',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--prod') out.target = 'prod';
    else if (a === '--staging') out.target = 'staging';
    else if (a === '--test-set') out.testSetId = args[++i]!;
    else if (a === '--arm-a') out.armSessions.A = args[++i]!;
    else if (a === '--arm-b') out.armSessions.B = args[++i]!;
    else if (a === '--arm-c') out.armSessions.C = args[++i]!;
    else if (a === '--arm-d') out.armSessions.D = args[++i]!;
    else if (a === '--out') out.outPath = args[++i]!;
  }
  if (!out.testSetId) throw new Error('--test-set <uuid> is required');
  if (Object.keys(out.armSessions).length < 2) {
    throw new Error('at least 2 --arm-{A|B|C|D} <sessionId> required');
  }
  return out;
}

// ─── DB ───────────────────────────────────────────────────────────────

async function connectDb(target: 'staging' | 'prod'): Promise<Client> {
  const envFile = target === 'prod' ? '.env.prod.readonly' : '.env.staging.readonly';
  const envVar = target === 'prod' ? 'PROD_READONLY_DATABASE_URL' : 'STAGING_READONLY_DATABASE_URL';
  dotenv.config({ path: path.join(process.cwd(), envFile) });
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} not set (load from ${envFile})`);
  const db = new Client({ connectionString: url });
  await db.connect();
  return db;
}

// ─── Data load ────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  name: string;
  judge_model: string | null;
  judge_temperature: string | null;
  auto_repeats: number;
  holistic_prompt_override: string | null;
}

interface PairRow {
  comparison_id: string;
  v_low: string;
  v_high: string;
  overall_winner: Verdict3 | null;
  forward_winner: 'a' | 'b' | 'tie' | null;
  reverse_winner: 'a' | 'b' | 'tie' | null;
  confidence: number | null;
  flip: boolean;
}

interface VerdictRow {
  comparison_id: string;
  criteria_id: string;
  verdict: Verdict3;
}

async function loadSession(db: Client, sessionId: string): Promise<SessionRow> {
  const r = await db.query<SessionRow>(
    `SELECT id, name, judge_model, judge_temperature, auto_repeats, holistic_prompt_override
       FROM evolution_weight_inference_sessions WHERE id = $1`,
    [sessionId],
  );
  if (r.rows.length === 0) throw new Error(`session not found: ${sessionId}`);
  return r.rows[0]!;
}

async function loadPairs(db: Client, sessionId: string): Promise<PairRow[]> {
  const r = await db.query<PairRow>(
    `SELECT
        c.id AS comparison_id,
        LEAST(a1.variant_id::text, a2.variant_id::text) AS v_low,
        GREATEST(a1.variant_id::text, a2.variant_id::text) AS v_high,
        c.overall_winner, c.forward_winner, c.reverse_winner, c.confidence,
        (a1.variant_id::text > a2.variant_id::text) AS flip
       FROM evolution_weight_inference_comparisons c
       JOIN evolution_weight_inference_articles a1 ON a1.id = c.article_a_id
       JOIN evolution_weight_inference_articles a2 ON a2.id = c.article_b_id
       WHERE c.session_id = $1 AND c.pass = 0 AND c.source = 'llm'`,
    [sessionId],
  );
  return r.rows;
}

async function loadVerdicts(db: Client, comparisonIds: string[]): Promise<Map<string, Record<string, Verdict3>>> {
  if (comparisonIds.length === 0) return new Map();
  const r = await db.query<VerdictRow>(
    `SELECT comparison_id, criteria_id, verdict
       FROM evolution_weight_inference_dimension_verdicts
       WHERE comparison_id = ANY($1::uuid[])`,
    [comparisonIds],
  );
  const out = new Map<string, Record<string, Verdict3>>();
  for (const row of r.rows) {
    let m = out.get(row.comparison_id);
    if (!m) { m = {}; out.set(row.comparison_id, m); }
    m[row.criteria_id] = row.verdict;
  }
  return out;
}

async function loadCriteria(db: Client, sessionId: string): Promise<Array<{ id: string; name: string; position: number }>> {
  const r = await db.query<{ id: string; name: string; position: number }>(
    `SELECT wic.criteria_id AS id, ec.name AS name, wic.position
       FROM evolution_weight_inference_criteria wic
       JOIN evolution_criteria ec ON ec.id = wic.criteria_id
       WHERE wic.session_id = $1
       ORDER BY wic.position`,
    [sessionId],
  );
  return r.rows;
}

// ─── Verdict flipping (re-orient article-row order to variant-id canonical) ─

function flipVerdict<T extends string>(v: T | null): T | null {
  if (v == null) return null;
  if (v === 'a') return 'b' as T;
  if (v === 'b') return 'a' as T;
  return v;
}

// ─── Per-arm fit + audit ──────────────────────────────────────────────

interface ArmResult {
  arm: ArmKey;
  sessionId: string;
  sessionName: string;
  judgeModel: string | null;
  judgeTemperature: string | null;
  autoRepeats: number;
  hashVerified: boolean;
  pairSetHash: string;
  nPairs: number;
  nFitPairs: number;
  trainAccuracy: number;
  heldOutAccuracy: number | null;
  degenerate: boolean;
  flags: ReturnType<typeof fitWeights>['flags'];
  weights: Array<{ criterion: string; weight: number; ciLow: number; ciHigh: number }>;
  positionBias: { n: number; flips: number; rate: number };
  pairs: Array<{
    pairKey: string;
    overall: Verdict3 | null;
    dims: Record<string, Verdict3>;
    forward: 'a' | 'b' | 'tie' | null;
    reverse: 'a' | 'b' | 'tie' | null;
  }>;
}

async function analyzeArm(db: Client, arm: ArmKey, sessionId: string): Promise<ArmResult> {
  const session = await loadSession(db, sessionId);
  const criteria = await loadCriteria(db, sessionId);
  const critIds = criteria.map((c) => c.id);
  const critNameById = new Map(criteria.map((c) => [c.id, c.name]));

  // Hash-verify override (Arm A: NULL → use canonical hardcoded checklist).
  const subject = session.holistic_prompt_override ?? ARM_A_CANONICAL_RUBRIC_BLOCK;
  const hashVerified = verifyArmHash(arm, session.holistic_prompt_override);
  if (!hashVerified) {
    const actualHash = sha256Hex(subject);
    throw new Error(
      `Arm ${arm}: persisted override hash ${actualHash} not in ACCEPTED_HASHES[${arm}]. ` +
        `If this is a legitimate prompt edit, APPEND the new hash to experimentArms.ts. ` +
        `Otherwise the session was created with a tampered override.`,
    );
  }

  const pairs = await loadPairs(db, sessionId);
  const verdictsByComp = await loadVerdicts(db, pairs.map((p) => p.comparison_id));

  // Pair-set hash (canonical variant-id order, sorted) for cross-arm frozenness check.
  const pairSetKeys = pairs.map((p) => `${p.v_low}|${p.v_high}`).sort();
  const pairSetHash = sha256Hex(pairSetKeys.join('\n'));

  // Build per-pair observations re-oriented to variant-id canonical order so cross-arm
  // comparison is apples-to-apples.
  const observations: PairObservation[] = [];
  interface PairRecord {
    pairKey: string;
    overall: Verdict3 | null;
    dims: Record<string, Verdict3>;
    forward: 'a' | 'b' | 'tie' | null;
    reverse: 'a' | 'b' | 'tie' | null;
  }
  const pairRecords: PairRecord[] = [];
  for (const p of pairs) {
    const overall = p.flip ? flipVerdict(p.overall_winner) : p.overall_winner;
    const rawDims = verdictsByComp.get(p.comparison_id) ?? {};
    const dims: Record<string, Verdict3> = {};
    for (const id of critIds) {
      const v = rawDims[id];
      if (v == null) continue;
      dims[id] = (p.flip ? flipVerdict(v) : v) as Verdict3;
    }
    const forward = p.flip ? flipVerdict(p.forward_winner) : p.forward_winner;
    const reverse = p.flip ? flipVerdict(p.reverse_winner) : p.reverse_winner;
    pairRecords.push({
      pairKey: `${p.v_low}|${p.v_high}`,
      overall,
      dims,
      forward,
      reverse,
    });
    if (overall != null) {
      observations.push({ overall, dims, confidence: p.confidence != null ? Number(p.confidence) : 1 });
    }
  }

  const fit = fitWeights(observations, critIds);
  const cis = weightCIs(observations, critIds, { seed: 1, iterations: 300 });
  const ciById = new Map(cis.map((c) => [c.criteriaId, c]));

  // Position bias per arm: forward vs reverse winner of pass=0 rows.
  let n = 0, flips = 0;
  for (const rec of pairRecords) {
    if (rec.forward == null || rec.reverse == null) continue;
    n++;
    if ((rec.forward === 'a' && rec.reverse === 'b') || (rec.forward === 'b' && rec.reverse === 'a')) flips++;
  }

  return {
    arm,
    sessionId,
    sessionName: session.name,
    judgeModel: session.judge_model,
    judgeTemperature: session.judge_temperature,
    autoRepeats: session.auto_repeats,
    hashVerified: true,
    pairSetHash,
    nPairs: pairs.length,
    nFitPairs: fit.nPairs,
    trainAccuracy: fit.trainAccuracy,
    heldOutAccuracy: fit.heldOutAccuracy,
    degenerate: fit.degenerate,
    flags: fit.flags,
    weights: critIds.map((id) => {
      const w = fit.weights.find((x) => x.criteriaId === id);
      const ci = ciById.get(id);
      return {
        criterion: critNameById.get(id) ?? id,
        weight: w?.weight ?? 0,
        ciLow: ci?.ciLow ?? 0,
        ciHigh: ci?.ciHigh ?? 0,
      };
    }),
    positionBias: { n, flips, rate: n > 0 ? flips / n : 0 },
    pairs: pairRecords,
  };
}

// ─── Cross-arm metrics ────────────────────────────────────────────────

function l1Distance(a: ArmResult, b: ArmResult): number {
  let d = 0;
  for (let i = 0; i < a.weights.length; i++) d += Math.abs(a.weights[i]!.weight - b.weights[i]!.weight);
  return d;
}
function cosine(a: ArmResult, b: ArmResult): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.weights.length; i++) {
    dot += a.weights[i]!.weight * b.weights[i]!.weight;
    na += a.weights[i]!.weight ** 2;
    nb += b.weights[i]!.weight ** 2;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const r = new Array(xs.length).fill(0);
  for (let i = 0; i < idx.length; i++) r[idx[i]!.i] = i + 1;
  return r;
}
function spearman(a: ArmResult, b: ArmResult): number {
  const ra = rank(a.weights.map((w) => w.weight));
  const rb = rank(b.weights.map((w) => w.weight));
  const n = ra.length;
  let mean_a = 0, mean_b = 0;
  for (let i = 0; i < n; i++) { mean_a += ra[i]!; mean_b += rb[i]!; }
  mean_a /= n; mean_b /= n;
  let num = 0, dena = 0, denb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i]! - mean_a, db = rb[i]! - mean_b;
    num += da * db; dena += da * da; denb += db * db;
  }
  return dena === 0 || denb === 0 ? 0 : num / Math.sqrt(dena * denb);
}

function holisticFlipRate(a: ArmResult, b: ArmResult): { n: number; flips: number; rate: number } {
  const byKey = new Map(a.pairs.map((p) => [p.pairKey, p.overall]));
  let n = 0, flips = 0;
  for (const p of b.pairs) {
    const av = byKey.get(p.pairKey);
    if (av == null || p.overall == null) continue;
    n++;
    if (av !== p.overall) flips++;
  }
  return { n, flips, rate: n > 0 ? flips / n : 0 };
}

// ─── Stable JSON serializer ───────────────────────────────────────────

function sortedJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortKeys((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const db = await connectDb(args.target);

  const armOrder: ArmKey[] = (['A', 'B', 'C', 'D'] as const).filter(
    (k) => args.armSessions[k] !== undefined,
  );

  const arms: ArmResult[] = [];
  for (const k of armOrder) {
    const sid = args.armSessions[k]!;
    arms.push(await analyzeArm(db, k, sid));
  }

  await db.end();

  // Test-set frozenness invariant: all arms must hash to the same pair-set.
  const distinctPairSetHashes = new Set(arms.map((a) => a.pairSetHash));
  if (distinctPairSetHashes.size > 1) {
    throw new Error(
      `Test-set pair set drifted between arms — cross-arm comparison invalid. ` +
        `Per-arm pair-set hashes: ${arms.map((a) => `${a.arm}=${a.pairSetHash.slice(0, 12)}`).join(', ')}`,
    );
  }

  // Cross-arm matrix (only fill upper triangle; lower mirrors).
  const crossArm: Record<string, Record<string, {
    l1: number;
    cosine: number;
    spearman: number;
    overallFlip: { n: number; flips: number; rate: number };
    topCriterion_A: string;
    topCriterion_B: string;
  }>> = {};
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i]!, b = arms[j]!;
      crossArm[a.arm] ??= {};
      crossArm[a.arm]![b.arm] = {
        l1: l1Distance(a, b),
        cosine: cosine(a, b),
        spearman: spearman(a, b),
        overallFlip: holisticFlipRate(a, b),
        topCriterion_A: [...a.weights].sort((x, y) => y.weight - x.weight)[0]!.criterion,
        topCriterion_B: [...b.weights].sort((x, y) => y.weight - x.weight)[0]!.criterion,
      };
    }
  }

  const report = {
    generated_at: 'pinned-by-runner',
    target: args.target,
    test_set_id: args.testSetId,
    arms: arms.map((a) => ({
      arm: a.arm,
      sessionId: a.sessionId,
      sessionName: a.sessionName,
      judgeModel: a.judgeModel,
      judgeTemperature: a.judgeTemperature,
      autoRepeats: a.autoRepeats,
      armLabel: EXPERIMENT_ARMS[a.arm].label,
      armDescription: EXPERIMENT_ARMS[a.arm].description,
      acceptedHashesEntries: ACCEPTED_HASHES[a.arm].length,
      pairSetHash: a.pairSetHash,
      nPairs: a.nPairs,
      nFitPairs: a.nFitPairs,
      trainAccuracy: a.trainAccuracy,
      heldOutAccuracy: a.heldOutAccuracy,
      degenerate: a.degenerate,
      flags: a.flags,
      weights: a.weights,
      positionBias: a.positionBias,
    })),
    crossArm,
  };

  const outAbs = path.resolve(process.cwd(), args.outPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, sortedJson(report) + '\n');
  console.log(`Wrote ${outAbs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
