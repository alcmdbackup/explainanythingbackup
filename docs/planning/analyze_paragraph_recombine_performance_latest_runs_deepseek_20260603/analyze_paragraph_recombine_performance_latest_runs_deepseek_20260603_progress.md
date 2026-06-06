# Analyze Paragraph Recombine Performance (Latest Runs, DeepSeek) Progress

## Research (completed 2026-06-03)
### Method
Inline recon (verify read-only query tool, real table schemas, dataset existence) → 5-round × 4-agent workflow (20 agents, run `wf_00b2d092-0e6`) querying DEV Supabase, with an adversarial verification round. Findings cross-checked against my own ground-truth queries. Full results in `_research.md`.

### Dataset identified
11 DeepSeek paragraph_recombine invocations, all 2026-06-03 (the only ones on staging): deepseek-v4-flash ×7 (57 slots), deepseek-v4-pro ×4 (33 slots), judge qwen-2.5-7b-instruct. `deepseek-chat` strategies exist but ran no paragraph_recombine. Uses `rewritesPerParagraph=6`.

### Key findings (see _research.md for full detail + side-by-side examples)
1. **Per-slot helped: 91% flash / 97% pro** (`winnerIsOriginal=false`). The ~98%-draw freeze is fixed (draws now ~47–53%); index-0 "tighten" length_under catastrophe fixed (15.6%).
2. **Article-level payoff weak:** flash 1/7 runs `is_winner`, pro 0/4. Per-slot judge ≠ article judge — recombination is the leak. **The headline "did it help": locally yes, globally mostly no.**
3. **Matches:** 1,204 comparisons; execution_detail counts == real arena rows exactly. flash median 20 matches/slot, pro 6. Persistence gap: original-slot entries persist arena_match_count=0 (known class).
4. **Temp ladder wasteful:** 40.9% drop rate, dominated by length_over from temps 1.8/2.0 (drop 71%/90%, ZERO winners). Temp 1.2 produces 68% of winners. Trimming top rungs ≈ −33% gen cost, 0 winner loss.
5. **Judge (qwen) is the bottleneck:** A-position skew (winner='b' 0/1,204 here), quantized confidence; pro draws MORE than flash (can't cash in pro's quality).
6. **Cost:** 3–5× the gemini/qwen baseline (flash 2.9×, pro 5.2×); all undershoot estimate (mean −34.75%). 7 llm_errors clustered in one pro run.

### Caveats (validated)
- A-position skew partially inflates helped rate (not fatal — b-wins exist globally, originals win 5 slots, Elo separates).
- flash vs pro share ZERO topics → quality comparison directional only (topic + pool-maturity confound).
- n=11, one day, one judge.

### Side-by-side examples captured
- HELPED: "original + one concrete analogy at temp 1.2" — operational-backbone, farmer/apples, fire-department, pilot-in-clouds, thermostat, valve (mu 25→38–40, clean sweeps).
- HURT/NO-OP: (A) original literally wins when high-temp rungs die (`18a02b43`/`60748a1b`/`d23cc798`); (B) prior-invocation entrenchment (`654973fe` beats all fresh rewrites twice); (C) length floor kills the reasonable 685c tighten rewrite; (D) high-temp word-salad up to 12,969 chars / total dropout (pro slot 9 all 6 empty).

### Issues Encountered
- Read-only query tool (`npm run query:staging`) and `.env.staging.readonly` confirmed working.
- Workflow R5 critic overstated judge position bias as "fatal"; calibrated against ground truth (b-wins do occur globally; 213/928 a-wins had lower-mu winner) → real-but-not-fatal caveat.

### User Clarifications
- User requested: examples of how paragraph_recombine hurt or helped, side-by-side paragraph comparison; match history and # of matches played. (All addressed.)
- User instructed: 5 rounds of 4 agents, query supabase dev, examples to back intuition. (Done via workflow.)

## Follow-up investigations (2026-06-03, in _research.md)
- **Article-level leak deep-dive:** per-slot wins don't become article wins because (1) recombined article enters the article arena fresh and plays only 3 matches — per-slot Elo (6–40 matches/slot) discarded; (2) competes as 1 variant vs 14–25 other-tactic variants, beats weak parent (often Elo 1105) but mid-pack; (3) 62–67% draws + position bias = near-random article signal; (4) greedy per-slot analogy-stuffing → 5–14% longer, metaphor-jumbled, incoherent whole (one article stacked haystack-fire + judge-tenure + fire-department + bathtub).
- **Approach tracking:** the rewrite directive (0 tighten / 1 add-analogy / 2 flow) is NOT a persisted field — only recoverable via `index % 3`, and confounded with the temperature ladder. Recovered per-approach: add-analogy wins 56/69 slots (81%) but drops 42%; tighten safest (22.6% drop) but wins 4; flow drops most (57.9%), wins 9. The winning approach (analogy) is the same one hurting article coherence. Capability gap: no first-class approach identity → per-approach effectiveness not directly queryable.

## Next
- Ready for `/plan-review` or brainstorming. Research surfaces 8 open questions. Highest-leverage actionable findings: (a) temperature-ladder waste — drop rungs 1.6/2.0, ~−33% gen cost, 0 winner loss (cheap win); (b) the article-level recombination leak — give the recombined article more article-level matches / seed its rating from per-slot results / cap analogy density (the real performance question); (c) add an explicit `directive`/`approach` field to enable per-approach attribution.
