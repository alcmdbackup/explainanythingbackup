// Sample-article fixtures for Phase 2.F.2 sample-article tests + Phase 3.8.
// Each scenario provides a realistic-content original + the proposer markup +
// approver decisions + the expected final variant text after applying accepted
// edits. Drives golden-master regression coverage of the parser + applier on
// non-toy content.

export interface SampleArticleScenario {
  /** Identifier for test reporting (`expect(scenario).toBe('darwin-finches')`). */
  name: string;
  /** Scenario subtype: 'allAccept' / 'allReject' / 'mixed'. */
  subtype: 'allAccept' | 'allReject' | 'mixed';
  /** Source article content. */
  original: string;
  /** Proposer's marked-up output (must strip-markup-equivalent to `original`). */
  proposedMarkup: string;
  /** Expected approver-accepted group numbers. */
  acceptGroups: number[];
  /** Expected approver-rejected group numbers. */
  rejectGroups: number[];
  /** Expected final article text after applying accepted edits + dropping rejected. */
  expectedNewText: string;
}

const FINCHES_ORIGINAL = `# Galápagos Finches

Charles Darwin observed thirteen species of finches across the Galápagos Islands. Each species had developed a distinct beak shape suited to its food source.

The differences in beak morphology helped Darwin formulate his theory of natural selection. Insectivorous finches had thin, pointed beaks. Seed-eaters had thick, crushing beaks.`;

const FINCHES_MARKUP_ALL_ACCEPT = `# Galápagos Finches

Charles Darwin observed thirteen species of finches across the Galápagos Islands. {~~ [#1] Each species had developed a distinct beak shape suited to its food source. ~> Each species had evolved a distinct beak shape adapted to its food source. ~~}

The differences in beak morphology helped Darwin formulate his theory of natural selection. {~~ [#2] Insectivorous finches had thin, pointed beaks. ~> Insect-eating finches had thin, pointed beaks. ~~} {~~ [#3] Seed-eaters had thick, crushing beaks. ~> Seed-eaters had thick, powerful beaks. ~~}`;

const FINCHES_FINAL_ALL_ACCEPT = `# Galápagos Finches

Charles Darwin observed thirteen species of finches across the Galápagos Islands. Each species had evolved a distinct beak shape adapted to its food source.

The differences in beak morphology helped Darwin formulate his theory of natural selection. Insect-eating finches had thin, pointed beaks. Seed-eaters had thick, powerful beaks.`;

const QUANTUM_ORIGINAL = `# Quantum Entanglement

Two particles can become entangled in a way that their properties are correlated regardless of distance. Measuring one particle instantly affects the other.

Einstein called this "spooky action at a distance" because it seemed to violate the principle of locality. Modern experiments have confirmed entanglement is real and is used in quantum computing.`;

const QUANTUM_MARKUP_MIXED = `# Quantum Entanglement

Two particles can become entangled in a way that their properties are correlated regardless of distance. {~~ [#1] Measuring one particle instantly affects the other. ~> Measuring one particle's state instantly determines the other's correlated state. ~~}

{~~ [#2] Einstein called this "spooky action at a distance" because it seemed to violate the principle of locality. ~> Einstein famously called this phenomenon "spooky action at a distance" because it appeared to violate the principle of locality. ~~} {-- [#3] Modern experiments have confirmed entanglement is real and is used in quantum computing. --}`;

const QUANTUM_FINAL_MIXED = `# Quantum Entanglement

Two particles can become entangled in a way that their properties are correlated regardless of distance. Measuring one particle's state instantly determines the other's correlated state.

Einstein called this "spooky action at a distance" because it seemed to violate the principle of locality. Modern experiments have confirmed entanglement is real and is used in quantum computing.`;

export const SAMPLE_SCENARIOS: SampleArticleScenario[] = [
  {
    name: 'darwin-finches',
    subtype: 'allAccept',
    original: FINCHES_ORIGINAL,
    proposedMarkup: FINCHES_MARKUP_ALL_ACCEPT,
    acceptGroups: [1, 2, 3],
    rejectGroups: [],
    expectedNewText: FINCHES_FINAL_ALL_ACCEPT,
  },
  {
    name: 'darwin-finches',
    subtype: 'allReject',
    original: FINCHES_ORIGINAL,
    proposedMarkup: FINCHES_MARKUP_ALL_ACCEPT, // same proposer output, different decisions
    acceptGroups: [],
    rejectGroups: [1, 2, 3],
    expectedNewText: FINCHES_ORIGINAL, // all-rejected → output equals input (idempotency)
  },
  {
    name: 'quantum-entanglement',
    subtype: 'mixed',
    original: QUANTUM_ORIGINAL,
    proposedMarkup: QUANTUM_MARKUP_MIXED,
    acceptGroups: [1],
    rejectGroups: [2, 3],
    expectedNewText: QUANTUM_FINAL_MIXED,
  },
];
