// Barrel for the tactic registry. Exports all tactic groups, lookup functions, palette, and categories.

export type { TacticDef } from './types';
export { SYSTEM_GENERATE_TACTICS, GENERATE_TACTIC_NAMES } from './generateTactics';
export type { GenerateTacticName } from './generateTactics';
export { selectTacticWeighted } from './selectTacticWeighted';
export type { GuidanceEntry } from './selectTacticWeighted';

import type { TacticDef } from './types';
import { SYSTEM_GENERATE_TACTICS, GENERATE_TACTIC_NAMES } from './generateTactics';
import type { GenerateTacticName } from './generateTactics';

// ─── Flat union across all agent tactic groups ──────────────────

/** All system-defined tactics across all agent types. Extend when adding SYSTEM_EVOLVE_TACTICS etc. */
export const ALL_SYSTEM_TACTICS: Record<string, TacticDef> = {
  ...SYSTEM_GENERATE_TACTICS,
  // ...SYSTEM_EVOLVE_TACTICS,  // future
};

/** Union of all tactic names across all agent groups. */
export type TacticName = GenerateTacticName; // | EvolveTacticName  // future

export const ALL_TACTIC_NAMES: string[] = [...GENERATE_TACTIC_NAMES];

// ─── Lookup functions ───────────────────────────────────────────

/** Get a tactic definition by name. Returns undefined for unknown tactics. */
export function getTacticDef(name: string): TacticDef | undefined {
  return ALL_SYSTEM_TACTICS[name];
}

/** Type guard: is this string a known system tactic name? */
export function isValidTactic(name: string): name is TacticName {
  return name in ALL_SYSTEM_TACTICS;
}

// ─── Categories ─────────────────────────────────────────────────

export const TACTICS_BY_CATEGORY: Record<string, string[]> = (() => {
  const result: Record<string, string[]> = {};
  for (const [name, def] of Object.entries(ALL_SYSTEM_TACTICS)) {
    const cat = def.category;
    if (!result[cat]) result[cat] = [];
    result[cat]!.push(name);
  }
  return result;
})();

// ─── Color palette ──────────────────────────────────────────────

/** Tactic-to-hex color mapping for lineage graphs and variant cards. Organized by category hue. */
export const TACTIC_PALETTE: Record<string, string> = {
  // Core (existing)
  structural_transform: '#3b82f6',  // blue
  lexical_simplify: '#22c55e',      // green
  grounding_enhance: '#f97316',     // orange

  // Extended
  engagement_amplify: '#8b5cf6',    // violet
  style_polish: '#a78bfa',          // light violet
  argument_fortify: '#7c3aed',      // deep violet
  narrative_weave: '#6d28d9',       // purple
  tone_transform: '#c084fc',        // lavender

  // Depth & Knowledge — teal family
  analogy_bridge: '#14b8a6',        // teal
  expert_deepdive: '#0d9488',       // dark teal
  historical_context: '#2dd4bf',    // light teal
  counterpoint_integrate: '#0f766e', // deep teal

  // Audience-Shift — purple/magenta family
  pedagogy_scaffold: '#d946ef',     // fuchsia
  curiosity_hook: '#ec4899',        // pink
  practitioner_orient: '#f472b6',   // light pink

  // Structural Innovation — amber family
  zoom_lens: '#f59e0b',            // amber
  progressive_disclosure: '#d97706', // dark amber
  contrast_frame: '#fbbf24',        // light amber

  // Quality & Precision — rose family
  precision_tighten: '#e11d48',     // rose
  coherence_thread: '#f43f5e',      // light rose
  sensory_concretize: '#fb7185',    // pale rose

  // Meta/Experimental — cyan family
  compression_distill: '#06b6d4',   // cyan
  expansion_elaborate: '#0891b2',   // dark cyan
  first_principles: '#22d3ee',      // light cyan

  // Special (non-tactic variant types)
  seed_variant: '#94a3b8',          // slate
  mutate_clarity: '#a855f7',        // purple (legacy evolve)
  crossover: '#a855f7',            // purple (legacy evolve)
  mutate_engagement: '#a855f7',     // purple (legacy evolve)

  // Tree search prefixed variants
  tree_search_edit_dimension: '#eab308',
  tree_search_structural_transform: '#3b82f6',
  tree_search_lexical_simplify: '#22c55e',
  tree_search_grounding_enhance: '#f97316',
  tree_search_creative: '#ec4899',
};

// ─── Default tactics ────────────────────────────────────────────

/** The 3 core tactics used when no explicit tactic list is configured. */
export const DEFAULT_TACTICS = [
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
] as const;

/** Collision guard: verify no key overlap between agent tactic groups at module load. */
(() => {
  // Only GENERATE_TACTIC_NAMES for now. Extend when EVOLVE_TACTIC_NAMES etc. are added.
  const allKeys = [...GENERATE_TACTIC_NAMES];
  if (new Set(allKeys).size !== allKeys.length) {
    throw new Error('Tactic name collision between agent groups');
  }
})();
