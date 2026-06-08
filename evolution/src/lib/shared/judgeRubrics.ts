// Default judge-comparison rubric blocks — the portion a Judge Lab "custom judge prompt"
// overrides. Kept dependency-free (no Node-only imports) so both the server-side prompt
// builder (computeRatings.ts) and the client-side Judge Lab page can import them without
// pulling `crypto`/`openskill` into the browser bundle.

export const ARTICLE_SANDBOX_RUBRIC =
  'You are an expert writing evaluator. Compare the two text variations (Text A and Text B) ' +
  'and decide which is better, considering clarity and readability, structure and flow, ' +
  'engagement and impact, grammar and style, and overall effectiveness.';

export const PARAGRAPH_SANDBOX_RUBRIC =
  'You are an expert writing evaluator. You will be shown two versions (Text A and Text B) of ' +
  'the SAME single paragraph. Decide which is the stronger paragraph, considering clarity and ' +
  'concision, sentence fluency, fidelity to the original meaning, and usefulness of added detail.';
