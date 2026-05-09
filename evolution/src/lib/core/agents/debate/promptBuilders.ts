// Prompt builders for DebateThenGenerateFromPreviousArticleAgent (Option C — 2 LLM calls).
// (bring_back_debate_agent_20260506 Phase 2.2.)
//
// V1 had three prompts (Advocate A → Advocate B → Judge). V2 Option C collapses
// the three into ONE combined "analyze + judge" prompt that asks for structured
// pros/cons of both variants AND the judge's verdict in a single response.
// Decision §17 + §19: prompt is identical regardless of debateJudgeReasoningEffort —
// reasoning models think first then write structured output downstream of thinking.

/** Critique-context block shape — built per-variant by Phase 2.4 helper. */
export interface CritiqueContextBlock {
  /** Last K wins for the variant (judge text + winner side). */
  pastWins: ReadonlyArray<{ summary: string }>;
  /** Last K losses for the variant. */
  pastLosses: ReadonlyArray<{ summary: string }>;
}

/**
 * Build the combined analyze+judge prompt. Single LLM call asks for:
 *   - prosA / consA / prosB / consB (specific strengths + weaknesses per parent)
 *   - winner ('A' | 'B' | 'tie')
 *   - reasoning (1-2 sentence verdict justification)
 *   - strengthsFromA / strengthsFromB (what to preserve in synthesis)
 *   - improvements (actionable changes for the synthesis)
 *
 * Returns a single string. JSON output expected — parser tolerates markdown fences.
 */
export function buildCombinedAnalyzeAndJudgePrompt(
  variantA: { id: string; text: string },
  variantB: { id: string; text: string },
  critiqueContextA?: CritiqueContextBlock,
  critiqueContextB?: CritiqueContextBlock,
): string {
  const lines: string[] = [];
  lines.push(
    'You are a senior editor evaluating two competing article variants. ' +
    'Produce a structured analysis comparing them, then deliver a verdict.',
  );
  lines.push('');
  lines.push('## Variant A');
  lines.push('<<<CONTENT>>>');
  lines.push(variantA.text);
  lines.push('<<</CONTENT>>>');
  lines.push('');
  if (critiqueContextA) {
    lines.push('Variant A history:');
    lines.push(formatCritiqueContext(critiqueContextA));
    lines.push('');
  }
  lines.push('## Variant B');
  lines.push('<<<CONTENT>>>');
  lines.push(variantB.text);
  lines.push('<<</CONTENT>>>');
  lines.push('');
  if (critiqueContextB) {
    lines.push('Variant B history:');
    lines.push(formatCritiqueContext(critiqueContextB));
    lines.push('');
  }
  lines.push('## Task');
  lines.push(
    'Analyze both variants for clarity, structure, engagement, precision, and coherence. ' +
    'Cite specific passages. Then deliver a verdict and the actionable strengths to ' +
    'preserve from each in a synthesis revision.',
  );
  lines.push('');
  lines.push('## Output format');
  lines.push('Return a SINGLE JSON object with EXACTLY these 9 fields. No surrounding prose.');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "prosA": ["specific strength of A (cite passage)", "..."],');
  lines.push('  "consA": ["specific weakness of A (cite passage)", "..."],');
  lines.push('  "prosB": ["specific strength of B (cite passage)", "..."],');
  lines.push('  "consB": ["specific weakness of B (cite passage)", "..."],');
  lines.push('  "winner": "A" | "B" | "tie",');
  lines.push('  "reasoning": "1-2 sentence verdict justification",');
  lines.push('  "strengthsFromA": ["specific A strength to preserve in synthesis", "..."],');
  lines.push('  "strengthsFromB": ["specific B strength to preserve in synthesis", "..."],');
  lines.push('  "improvements": ["actionable improvement for the synthesis", "..."]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Each pros/cons/strengths/improvements array MUST contain at least one entry.');
  lines.push('Return ONLY valid JSON — no markdown, no explanatory prose outside the JSON.');
  return lines.join('\n');
}

/** Format a single critique-context block as a compact prose summary. */
function formatCritiqueContext(ctx: CritiqueContextBlock): string {
  const out: string[] = [];
  if (ctx.pastWins.length === 0 && ctx.pastLosses.length === 0) {
    return 'No prior match data.';
  }
  if (ctx.pastWins.length > 0) {
    out.push('Past wins:');
    ctx.pastWins.forEach((w, i) => {
      out.push(`  ${i + 1}. ${w.summary}`);
    });
  }
  if (ctx.pastLosses.length > 0) {
    out.push('Past losses:');
    ctx.pastLosses.forEach((l, i) => {
      out.push(`  ${i + 1}. ${l.summary}`);
    });
  }
  return out.join('\n');
}

// ─── Synthesis customPrompt builder ─────────────────────────────────

/** Judge verdict shape — output of Phase 2.3 parser. */
export interface DebateVerdict {
  prosA: ReadonlyArray<string>;
  consA: ReadonlyArray<string>;
  prosB: ReadonlyArray<string>;
  consB: ReadonlyArray<string>;
  winner: 'A' | 'B' | 'tie';
  reasoning: string;
  strengthsFromA: ReadonlyArray<string>;
  strengthsFromB: ReadonlyArray<string>;
  improvements: ReadonlyArray<string>;
}

/**
 * Build the synthesis customPrompt fed into inner GFPA.execute(). Embeds the verdict's
 * strengthsFromA / strengthsFromB / improvements lists. The inner GFPA uses this prompt
 * to revise the WINNER's text using the LOSER's strengths (per Decision §20: synthesis
 * revises the winner using the loser's strengths).
 */
export function buildSynthesisCustomPrompt(
  verdict: DebateVerdict,
): { preamble: string; instructions: string } {
  const preamble =
    'You are an expert article reviser. A judge has compared this article to a competing variant ' +
    'and identified specific strengths to preserve from each, plus actionable improvements. ' +
    'Produce a stronger synthesis by combining material from both variants. Aim for at least a ' +
    '70/30 blend — most of the result should retain the winning variant\'s structure and voice ' +
    '(roughly 70%), but at least 30% of the content should be substantively reshaped or imported ' +
    'from the competing variant\'s strengths. A pure paraphrase of either variant is not a synthesis.';

  const lines: string[] = [];
  lines.push("Apply the judge's recommendations to revise the article:");
  lines.push('');
  if (verdict.strengthsFromA.length > 0) {
    lines.push('Preserve these strengths from this variant:');
    verdict.strengthsFromA.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`);
    });
    lines.push('');
  }
  if (verdict.strengthsFromB.length > 0) {
    lines.push("Incorporate these strengths from the competing variant:");
    verdict.strengthsFromB.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`);
    });
    lines.push('');
  }
  if (verdict.improvements.length > 0) {
    lines.push('Address these specific improvements:');
    verdict.improvements.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`);
    });
    lines.push('');
  }
  lines.push(
    'Rewrite the article applying these recommendations. Aim for at least a 70/30 blend: keep roughly ' +
    '70% of the winning variant\'s structure/voice, and substantively reshape or import at least 30% ' +
    'from the competing variant\'s strengths — paragraph rewrites, restructured sections, or absorbed ' +
    'arguments. Preserve the original word count within ±10% — refactor or deepen existing passages ' +
    'rather than adding bolted-on new sections. Do not introduce meta-commentary about the article itself.',
  );
  return { preamble, instructions: lines.join('\n') };
}
