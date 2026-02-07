// Types for section-level decomposition of articles.
// Defines the data structures for parsing articles into H2 sections and tracking per-section edits.

/** A single section extracted from an article at H2 boundaries. */
export interface ArticleSection {
  /** Section index (0 = preamble, 1+ = H2 sections in order). */
  index: number;
  /** H2 heading text (null for preamble). */
  heading: string | null;
  /** Content after the heading line. */
  body: string;
  /** Full section markdown (heading + body). */
  markdown: string;
  /** True if this is the preamble (everything before first H2). */
  isPreamble: boolean;
}

/** Result of parsing an article into sections. */
export interface ParsedArticle {
  /** The original input text (for round-trip verification). */
  originalText: string;
  /** All sections including preamble. */
  sections: ArticleSection[];
  /** Number of H2 sections (excludes preamble). */
  sectionCount: number;
}

/** A variation of a single section produced by the section edit runner. */
export interface SectionVariation {
  /** Unique identifier for this variation. */
  id: string;
  /** Index of the section this variation replaces. */
  sectionIndex: number;
  /** H2 heading text (null for preamble). */
  heading: string | null;
  /** Content after the heading line. */
  body: string;
  /** Full section markdown (heading + body). */
  markdown: string;
  /** Edit strategy that produced this variation. */
  strategy: string;
  /** Cost in USD to generate this variation. */
  costUsd: number;
}

/** State for section-level evolution (used in PipelineState for checkpoint persistence). */
export interface SectionEvolutionState {
  /** Parsed sections from the source article. */
  sections: ArticleSection[];
  /** Best variation per section index (null = original kept). */
  bestVariations: Record<number, SectionVariation | null>;
}
