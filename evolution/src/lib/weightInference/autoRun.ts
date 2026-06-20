// Resumable + idempotent auto-run core: judges a CHUNK of un-judged source='llm' pairs for
// a weight-inference session, persists the verdicts, and reports remaining work. Pure of any
// app/LLM import — the route injects a `judgeFactory` that builds the callLLM closure (so this
// is unit-testable with a fake judge). Skips already-complete pairs, so re-invoking is safe
// (no double-spend); the route re-invokes until `done`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWithinWeightInferenceAutoCap, getAutoChunkPairs } from './autoCost';
import { foldRepeats, judgePairOnce, type JudgeText } from './autoJudge';
import type { ResolvedJudgeRubric } from '@evolution/lib/shared/rubricJudge';

export interface AutoChunkResult {
  done: boolean;
  remaining: number;
  judged: number;
  spendUsd: number;
}

/** Builds the LLM judge closure for a model/temperature/reasoning (cost flows to costAcc). */
export type JudgeFactory = (
  model: string,
  temperature: number | null,
  reasoning: string | null,
) => JudgeText;

const PAIR_CONCURRENCY = 4;

interface SessionRow {
  mode: string;
  pair_kind: 'article' | 'paragraph';
  judge_model: string | null;
  judge_temperature: number | null;
  judge_reasoning_effort: string | null;
  auto_repeats: number;
}

interface CompRow {
  id: string;
  article_a_id: string;
  article_b_id: string;
  overall_winner: string | null;
}

export async function runAutoChunk(
  db: SupabaseClient,
  sessionId: string,
  judgeFactory: JudgeFactory,
  costAcc: { usd: number },
): Promise<AutoChunkResult> {
  // 1. session
  const { data: s, error: sErr } = await db
    .from('evolution_weight_inference_sessions')
    .select('mode, pair_kind, judge_model, judge_temperature, judge_reasoning_effort, auto_repeats')
    .eq('id', sessionId)
    .is('deleted_at', null)
    .single();
  if (sErr || !s) throw new Error(`auto-run: session not found (${sErr?.message ?? 'no row'})`);
  const session = s as unknown as SessionRow;
  if (session.mode !== 'auto') throw new Error('auto-run: session is not in auto mode');
  if (!session.judge_model) throw new Error('auto-run: session has no judge_model');
  const repeats = Math.max(1, session.auto_repeats);

  // 2. criteria (ordered) -> rubric (equal placeholder weights; verdicts are weight-independent)
  const { data: critJ, error: cjErr } = await db
    .from('evolution_weight_inference_criteria')
    .select('criteria_id, position')
    .eq('session_id', sessionId)
    .order('position', { ascending: true });
  if (cjErr) throw new Error(`auto-run: load criteria (${cjErr.message})`);
  const criteriaIds = (critJ ?? []).map((r) => r.criteria_id as string);
  const { data: critRows, error: crErr } = await db
    .from('evolution_criteria')
    .select('id, name, description, min_rating, max_rating, evaluation_guidance')
    .in('id', criteriaIds);
  if (crErr) throw new Error(`auto-run: load criteria rows (${crErr.message})`);
  const critById = new Map((critRows ?? []).map((c) => [c.id as string, c]));
  const rubric: ResolvedJudgeRubric = {
    rubricId: sessionId,
    dimensions: criteriaIds.map((id) => {
      const c = critById.get(id);
      return {
        criteriaId: id,
        name: (c?.name as string) ?? id,
        description: (c?.description as string | null) ?? null,
        minRating: (c?.min_rating as number) ?? 1,
        maxRating: (c?.max_rating as number) ?? 10,
        evaluationGuidance: (c?.evaluation_guidance as ResolvedJudgeRubric['dimensions'][number]['evaluationGuidance']) ?? null,
        weight: 1,
      };
    }),
  };
  const nameById = new Map(rubric.dimensions.map((d) => [d.criteriaId, d.name]));
  const K = criteriaIds.length;

  // 3. find incomplete pass-0 llm comparisons (overall null OR < K dim verdicts)
  const { data: comps, error: compErr } = await db
    .from('evolution_weight_inference_comparisons')
    .select('id, article_a_id, article_b_id, overall_winner')
    .eq('session_id', sessionId)
    .eq('source', 'llm')
    .eq('pass', 0);
  if (compErr) throw new Error(`auto-run: load comparisons (${compErr.message})`);
  const allComps = (comps ?? []) as unknown as CompRow[];

  // dim verdict counts per comparison (to detect partially-judged pairs)
  const dimCount = new Map<string, number>();
  const compIds = allComps.map((c) => c.id);
  for (let i = 0; i < compIds.length; i += 100) {
    const chunkIds = compIds.slice(i, i + 100);
    const { data: dv } = await db
      .from('evolution_weight_inference_dimension_verdicts')
      .select('comparison_id')
      .in('comparison_id', chunkIds);
    for (const row of dv ?? []) {
      const id = row.comparison_id as string;
      dimCount.set(id, (dimCount.get(id) ?? 0) + 1);
    }
  }
  const incomplete = allComps.filter((c) => c.overall_winner == null || (dimCount.get(c.id) ?? 0) < K);
  const totalIncomplete = incomplete.length;
  if (totalIncomplete === 0) return { done: true, remaining: 0, judged: 0, spendUsd: 0 };

  const chunk = incomplete.slice(0, getAutoChunkPairs());

  // 4. pre-flight cost cap (this invocation's planned work)
  assertWithinWeightInferenceAutoCap({ remainingPairs: chunk.length, repeats });

  // 5. judge
  const judge = judgeFactory(session.judge_model, session.judge_temperature, session.judge_reasoning_effort);
  const articleIds = [...new Set(chunk.flatMap((c) => [c.article_a_id, c.article_b_id]))];
  const { data: arts, error: aErr } = await db
    .from('evolution_weight_inference_articles')
    .select('id, content')
    .in('id', articleIds);
  if (aErr) throw new Error(`auto-run: load articles (${aErr.message})`);
  const contentById = new Map((arts ?? []).map((a) => [a.id as string, a.content as string]));

  async function judgeOne(c: CompRow): Promise<void> {
    const textA = contentById.get(c.article_a_id) ?? '';
    const textB = contentById.get(c.article_b_id) ?? '';
    const results = [];
    for (let r = 0; r < repeats; r++) {
      results.push(await judgePairOnce(judge, textA, textB, rubric, costAcc, session.pair_kind));
    }
    const folded = foldRepeats(results);
    await db
      .from('evolution_weight_inference_comparisons')
      .update({
        overall_winner: folded.overall,
        forward_winner: folded.forwardWinner,
        reverse_winner: folded.reverseWinner,
        confidence: folded.overallConfidence,
        judge_model: session.judge_model,
        cost: folded.costUsd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.id);
    const dimRows = folded.dims.map((d, i) => ({
      comparison_id: c.id,
      criteria_id: d.criteriaId,
      criteria_name: nameById.get(d.criteriaId) ?? d.criteriaId,
      verdict: d.verdict,
      confidence: d.confidence,
      position: i,
    }));
    if (dimRows.length > 0) {
      await db
        .from('evolution_weight_inference_dimension_verdicts')
        .upsert(dimRows, { onConflict: 'comparison_id,criteria_id' });
    }
  }

  // bounded concurrency over the chunk
  for (let i = 0; i < chunk.length; i += PAIR_CONCURRENCY) {
    await Promise.all(chunk.slice(i, i + PAIR_CONCURRENCY).map((c) => judgeOne(c)));
  }

  const judged = chunk.length;
  const remaining = Math.max(0, totalIncomplete - judged);
  return { done: remaining === 0, remaining, judged, spendUsd: costAcc.usd };
}
