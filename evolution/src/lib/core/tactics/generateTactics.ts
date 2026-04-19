// System-defined generation tactics for GenerateFromSeedArticleAgent.
// Each tactic transforms source text via a specific LLM prompt technique.
// Git-controlled — prompt changes go through PR review.

import type { TacticDef } from './types';

export const SYSTEM_GENERATE_TACTICS = {
  // ─── Core (3) ─────────────────────────────────────────────────────

  structural_transform: {
    label: 'Structural Transform',
    category: 'core',
    preamble: 'You are an expert writing editor. AGGRESSIVELY restructure this text with full creative freedom.',
    instructions: 'Reorder sections, paragraphs, and ideas. Merge, split, or eliminate sections. Invert the structure (conclusion-first, bottom-up, problem-solution, narrative arc). Change heading hierarchy. Reorganize by chronological, thematic, comparative, or other principle. MUST preserve original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance.\n\nOutput a radically restructured version. Same core message, completely different organization. Do NOT make timid, incremental changes — reimagine the organization from scratch.',
  },

  lexical_simplify: {
    label: 'Lexical Simplify',
    category: 'core',
    preamble: 'You are an expert writing editor. Simplify the language of this text.',
    instructions: 'Replace complex words with simpler alternatives. Shorten overly long sentences. Remove unnecessary jargon. Improve accessibility. Maintain the meaning.\n\nOutput a lexically simplified version.',
  },

  grounding_enhance: {
    label: 'Grounding Enhance',
    category: 'core',
    preamble: 'You are an expert writing editor. Make this text more concrete and grounded.',
    instructions: 'Add specific examples and details. Make abstract concepts concrete. Include sensory details. Strengthen connection to real-world experience. Maintaining the core message.\n\nOutput a more grounded and concrete version.',
  },

  // ─── Extended (5) — previously documented but never implemented ────

  engagement_amplify: {
    label: 'Engagement Amplify',
    category: 'extended',
    preamble: 'You are an expert writing editor. Amplify reader engagement throughout this text.',
    instructions: 'Add compelling hooks at section openings. Improve pacing by varying sentence length and paragraph rhythm. Use rhetorical devices (questions, parallel structure, rule of three) to maintain reader interest. Create stronger transitions that pull the reader forward. Maintain accuracy and substance while making the text more engaging.\n\nOutput a more engaging version that readers want to keep reading.',
  },

  style_polish: {
    label: 'Style Polish',
    category: 'extended',
    preamble: 'You are an expert writing editor. Polish the prose style of this text.',
    instructions: 'Refine word choices for precision and elegance. Improve sentence flow and rhythm. Strengthen the authorial voice — make it confident and distinctive. Eliminate awkward phrasing, redundancy, and weak constructions. Tighten prose without losing nuance. Maintain the original meaning and structure.\n\nOutput a stylistically polished version with stronger, cleaner prose.',
  },

  argument_fortify: {
    label: 'Argument Fortify',
    category: 'extended',
    preamble: 'You are an expert writing editor. Strengthen the logical structure and argumentation of this text.',
    instructions: 'Strengthen causal reasoning and logical connections between claims. Add qualifying language where claims are overstated. Improve evidence-claim alignment — ensure each assertion is properly supported. Strengthen transitions that carry argumentative weight. Remove logical gaps and non-sequiturs. Maintain the original thesis and conclusions.\n\nOutput a version with stronger, more rigorous argumentation.',
  },

  narrative_weave: {
    label: 'Narrative Weave',
    category: 'extended',
    preamble: 'You are an expert writing editor. Weave stronger narrative threads through this text.',
    instructions: 'Identify the core narrative arc and strengthen it. Add narrative transitions that create a sense of progression and discovery. Weave recurring themes or motifs that connect disparate sections. Create a satisfying sense of resolution by the end. Improve coherence by linking ideas through story logic rather than just topical logic. Maintain factual accuracy.\n\nOutput a version with stronger narrative coherence and storytelling elements.',
  },

  tone_transform: {
    label: 'Tone Transform',
    category: 'extended',
    preamble: 'You are an expert writing editor. Transform the tone of this text to better serve its audience.',
    instructions: 'Identify the target audience and purpose, then unify the tone throughout. Remove tonal inconsistencies (e.g., mixing casual and formal). Adjust register, vocabulary, and sentence complexity to match the intended audience. Ensure the tone supports the content — authoritative for technical content, approachable for introductory content, precise for reference material. Maintain meaning and substance.\n\nOutput a version with a consistent, audience-appropriate tone.',
  },

  // ─── Depth & Knowledge (4) ────────────────────────────────────────

  analogy_bridge: {
    label: 'Analogy Bridge',
    category: 'depth',
    preamble: 'You are an expert writing editor. Enrich this text with vivid analogies and metaphors.',
    instructions: 'Identify abstract or unfamiliar concepts and add analogies that connect them to everyday experience. Use metaphors that illuminate mechanisms (not just similarities). Each analogy should make the reader think "ah, so it works like X." Vary the source domains — draw from cooking, construction, nature, sports, music, and other accessible areas. Do not force analogies where the concept is already clear. Maintain accuracy — analogies must be truthful, not misleading.\n\nOutput a version enriched with illuminating analogies and metaphors.',
  },

  expert_deepdive: {
    label: 'Expert Deepdive',
    category: 'depth',
    preamble: 'You are an expert writing editor with deep domain knowledge. Add technical depth to this text.',
    instructions: 'Add mechanisms, edge cases, caveats, and nuances that a knowledgeable reader would expect but the text currently omits. Explain not just what happens but why and under what conditions. Add boundary conditions and failure modes. Include relevant technical details that deepen understanding without overwhelming. Maintain the existing structure and flow while enriching content density.\n\nOutput a technically deeper version that satisfies expert readers.',
  },

  historical_context: {
    label: 'Historical Context',
    category: 'depth',
    preamble: 'You are an expert writing editor with broad historical knowledge. Add historical context to this text.',
    instructions: 'Weave in origin stories, key figures, and the timeline of discovery or development. Show how understanding evolved over time — what was believed before, what changed, and why. Add historical anecdotes that illuminate the subject. Connect past developments to present state. Use history to give the reader a sense of why things are the way they are. Maintain accuracy — do not fabricate historical details.\n\nOutput a version enriched with relevant historical context and narrative.',
  },

  counterpoint_integrate: {
    label: 'Counterpoint Integrate',
    category: 'depth',
    preamble: 'You are an expert writing editor. Strengthen this text by integrating counterpoints and addressing objections.',
    instructions: 'Identify the strongest objections, misconceptions, and alternative viewpoints about each major claim. Address them directly within the text as narrative paragraphs — present the objection fairly, then explain why the original position holds (or acknowledge where the objection has merit). Do not create bullet lists or numbered objections — weave counterpoints into the existing paragraph flow using transitions like "Critics argue that..." or "A common misconception is..." Maintain the original thesis while demonstrating awareness of its limitations.\n\nOutput a more intellectually honest version that acknowledges and addresses counterarguments.',
  },

  // ─── Audience-Shift (3) ───────────────────────────────────────────

  pedagogy_scaffold: {
    label: 'Pedagogy Scaffold',
    category: 'audience',
    preamble: 'You are an expert educator and writing editor. Restructure this text using teaching techniques.',
    instructions: 'Identify prerequisite concepts and ensure they appear before dependent concepts. Sequence information from simple to complex, concrete to abstract. Add brief "bridge" sentences at section transitions that connect what was just learned to what comes next. Where the text assumes knowledge, add a clarifying sentence. Use narrative transitions to signal progression ("Building on this foundation..." or "With that understanding in place..."). Do NOT use numbered steps, bullet lists, or "Step 1/Step 2" formatting — all scaffolding must be woven into paragraph prose.\n\nOutput a pedagogically scaffolded version that guides the reader through the material in a natural learning sequence.',
  },

  curiosity_hook: {
    label: 'Curiosity Hook',
    category: 'audience',
    preamble: 'You are an expert writing editor. Rewrite this text to maximize curiosity and reader pull.',
    instructions: 'Open sections with questions or puzzles before providing answers. Create information gaps that make the reader want to continue. Delay key revelations slightly to build anticipation. Use "open loops" — introduce intriguing premises early and resolve them later. Pose surprising facts or counterintuitive observations that challenge assumptions. Embed questions within paragraphs, not as standalone lists. Maintain accuracy and completeness — satisfy the curiosity you create.\n\nOutput a version that makes the reader genuinely curious and eager to keep reading.',
  },

  practitioner_orient: {
    label: 'Practitioner Orient',
    category: 'audience',
    preamble: 'You are an expert writing editor. Shift this text from theory to practice.',
    instructions: 'Transform "what X is" explanations into "how to use X" guidance. Add decision frameworks as narrative paragraphs — "When you encounter A, the approach is B because C." Include common pitfalls and how to avoid them. Add practical context: when this matters, when it does not, and what to try first. Present tradeoffs as connected prose, not comparison tables or checklists. Maintain technical accuracy while making the content actionable.\n\nOutput a practitioner-oriented version that helps readers apply the knowledge.',
  },

  // ─── Structural Innovation (3) ────────────────────────────────────

  zoom_lens: {
    label: 'Zoom Lens',
    category: 'structural',
    preamble: 'You are an expert writing editor. Restructure this text to alternate between macro and micro perspectives.',
    instructions: 'Create a rhythm of zooming out (big picture, context, significance) and zooming in (specific details, mechanisms, examples). Each section should oscillate between these perspectives. Start sections with a wide-angle view, then zoom into specifics, then pull back to connect the detail to the larger picture. This creates a "breathing" rhythm that keeps readers oriented while deepening understanding. Maintain all key points and accuracy.\n\nOutput a version that rhythmically alternates between big-picture context and precise detail.',
  },

  progressive_disclosure: {
    label: 'Progressive Disclosure',
    category: 'structural',
    preamble: 'You are an expert writing editor. Layer this text using progressive disclosure.',
    instructions: 'Restructure so the reader first gets a complete but simple version of the key ideas, then each subsequent section deepens one aspect. Think of it as zoom levels: the overview is the satellite view, then each section is a street-level view of one area. Use section headings (## or ###) to delineate layers. The first pass should be satisfying on its own — a reader who stops early should still have a coherent understanding. Later sections add nuance, exceptions, and advanced details. Maintain all content.\n\nOutput a progressively layered version where each section deepens the previous understanding.',
  },

  contrast_frame: {
    label: 'Contrast Frame',
    category: 'structural',
    preamble: 'You are an expert writing editor. Restructure this text around contrasts and comparisons.',
    instructions: 'Explain concepts primarily through comparison: what it is versus what it is not, the before versus the after, this approach versus alternatives. Use contrastive framing to sharpen definitions and highlight what makes each concept distinctive. Embed comparisons in paragraph prose — do not use comparison tables, side-by-side layouts, or bullet lists. Use transitional language like "Unlike X, this approach..." or "Where traditional methods fail, this succeeds because..." Maintain accuracy and completeness.\n\nOutput a version that sharpens understanding through systematic contrast and comparison.',
  },

  // ─── Quality & Precision (3) ──────────────────────────────────────

  precision_tighten: {
    label: 'Precision Tighten',
    category: 'quality',
    preamble: 'You are an expert writing editor. Tighten the precision of every claim in this text.',
    instructions: 'Eliminate hedge words (basically, somewhat, fairly, quite, rather), vague quantifiers (some, many, various, several), and weasel phrases (it is believed, studies show, experts say) unless specifically attributed. Replace each vague statement with a specific, concrete claim. "Many researchers" becomes a specific claim or is removed. "Somewhat effective" becomes a precise characterization. "Various factors" becomes named factors. Do not add information that is not implied by the original — tighten what exists, do not fabricate specifics.\n\nOutput a precisely worded version with no hedging or vague language.',
  },

  coherence_thread: {
    label: 'Coherence Thread',
    category: 'quality',
    preamble: 'You are an expert writing editor. Strengthen the coherence thread running through this text.',
    instructions: 'Ensure every paragraph flows logically to the next. The last sentence of each paragraph should plant a seed that the first sentence of the next paragraph picks up. Strengthen topic sentences to clearly signal what each paragraph contributes. Add transitional phrases that make the logical chain explicit. Identify and fix any jumps where the reader would think "wait, how did we get here?" Maintain all content and meaning.\n\nOutput a version where the logical thread from start to finish is unbroken and every transition is smooth.',
  },

  sensory_concretize: {
    label: 'Sensory Concretize',
    category: 'quality',
    preamble: 'You are an expert writing editor. Replace abstract language with vivid, sensory-specific words.',
    instructions: 'Target abstract verbs (utilize, implement, leverage, facilitate) and replace with concrete, action-oriented alternatives (build, run, connect, open). Target abstract nouns (methodology, framework, paradigm, infrastructure) and replace with specific, tangible equivalents where the context allows. Use language that evokes sensory experience — words the reader can see, hear, or feel. This is word-level precision, not adding examples or analogies. Maintain technical accuracy — some abstract terms are necessary and should be kept.\n\nOutput a version with vivid, concrete language replacing unnecessary abstractions.',
  },

  // ─── Meta/Experimental (3) ────────────────────────────────────────

  compression_distill: {
    label: 'Compression Distill',
    category: 'meta',
    preamble: 'You are an expert writing editor. Distill this text to its essential core.',
    instructions: 'Produce a significantly shorter version (60-70% of original length) that preserves ALL key information, arguments, and conclusions. Remove redundancy, verbose phrasing, and filler. Merge paragraphs that make the same point. Tighten every sentence. MUST retain all ## and ### section headings — compress by pruning paragraph content, not by removing structural sections. Every paragraph must still contain at least 2 sentences. Do not drop any key fact, argument, or conclusion — compress the expression, not the substance.\n\nOutput a distilled version that is substantially shorter but loses no essential content.',
  },

  expansion_elaborate: {
    label: 'Expansion Elaborate',
    category: 'meta',
    preamble: 'You are an expert writing editor. Identify and elaborate the thinnest section of this text.',
    instructions: 'Identify the section with the least depth relative to its importance — the part where a knowledgeable reader would think "this deserves more." Triple its depth by adding explanation, context, implications, and nuance. Add supporting detail via full paragraphs. Keep all other sections at their current depth — this is targeted expansion, not uniform inflation. Do not create bullet lists, numbered items, or tables even when elaborating. Use ## or ### headings for any new subsections.\n\nOutput a version where the weakest section is dramatically strengthened while others remain stable.',
  },

  first_principles: {
    label: 'First Principles',
    category: 'meta',
    preamble: 'You are an expert writing editor and educator. Rewrite this text from first principles.',
    instructions: 'Assume the reader has zero domain-specific knowledge. Rebuild every concept from its foundations — start with what the reader already knows from everyday life, then derive each new concept step by step. Replace jargon with plain language definitions before using the term. Show WHY each concept matters before explaining HOW it works. Build a chain of understanding where each paragraph depends only on what came before it. Do not use numbered steps or bullet lists — build understanding through connected narrative paragraphs.\n\nOutput a first-principles version that derives everything from basics, accessible to any intelligent reader.',
  },
} as const satisfies Record<string, TacticDef>;

export type GenerateTacticName = keyof typeof SYSTEM_GENERATE_TACTICS;

export const GENERATE_TACTIC_NAMES = Object.keys(SYSTEM_GENERATE_TACTICS) as GenerateTacticName[];
