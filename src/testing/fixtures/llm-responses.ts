/**
 * LLM Response Fixtures for Integration Testing
 *
 * Realistic mock responses for OpenAI API calls
 * Reuses and extends test-helpers.ts mock builders
 */

import { createMockOpenAIResponse } from '../utils/test-helpers';

/**
 * Mock response for title generation
 * Schema expects: { title1: string, title2: string, title3: string }
 */
export const titleGenerationResponse = createMockOpenAIResponse(
  JSON.stringify({
    title1: '[TEST] Understanding Quantum Entanglement',
    title2: '[TEST] Quantum Entanglement Explained',
    title3: '[TEST] The Science of Quantum Entanglement',
  })
);

/**
 * Mock response for explanation generation (non-streaming)
 */
export const explanationGenerationResponse = createMockOpenAIResponse(
  JSON.stringify({
    content: `# [TEST] Understanding Quantum Entanglement

Quantum entanglement is a physical phenomenon that occurs when pairs or groups of particles interact in ways such that the quantum state of each particle cannot be described independently.

## Key Concepts

1. **Superposition**: Particles exist in multiple states simultaneously
2. **Correlation**: Measurements on entangled particles are correlated
3. **Non-locality**: Effects appear to be instantaneous across distance

## Applications

- Quantum computing
- Quantum cryptography
- Quantum teleportation`,
    tags: ['quantum-physics', 'advanced', 'theoretical'],
    links: [
      { url: 'https://en.wikipedia.org/wiki/Quantum_entanglement', heading: 'Quantum Entanglement' },
    ],
  })
);

/**
 * Mock streaming response chunks for streaming explanation generation
 * Simulates how OpenAI sends chunks in streaming mode
 */
export const streamingChunks = [
  '# [TEST] Understanding',
  ' Quantum',
  ' Entanglement\n\n',
  'Quantum',
  ' entanglement',
  ' is a',
  ' physical phenomenon',
  '...',
];

/**
 * Mock streaming response for OpenAI streaming API
 * Format matches actual OpenAI streaming API structure
 */
export function createMockStreamingResponse(chunks: string[] = streamingChunks) {
  return {
    choices: [
      {
        delta: { content: chunks[0], role: 'assistant' },
        index: 0,
        finish_reason: null,
      },
    ],
  };
}

/**
 * Mock error response from OpenAI
 */
export const errorResponse = {
  error: {
    message: 'Rate limit exceeded',
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
  },
};

/**
 * Mock response for tag evaluation
 * Schema expects: { difficultyLevel: 1-3, length: 4-6, simpleTags: number[] | null }
 */
export const tagEvaluationResponse = createMockOpenAIResponse(
  JSON.stringify({
    difficultyLevel: 2,  // medium difficulty (1=easy, 2=medium, 3=hard)
    length: 5,           // medium length (4=short, 5=medium, 6=long)
    simpleTags: [7, 8, 9], // arbitrary tag IDs for testing
  })
);

/**
 * Helper to create a complete streaming response sequence
 */
export function* generateStreamingChunks(content: string, chunkSize: number = 10) {
  for (let i = 0; i < content.length; i += chunkSize) {
    yield {
      choices: [
        {
          delta: { content: content.slice(i, i + chunkSize) },
          index: 0,
          finish_reason: i + chunkSize >= content.length ? 'stop' : null,
        },
      ],
    };
  }
}

/**
 * Full explanation content for realistic testing
 */
export const fullExplanationContent = `# [TEST] Understanding Quantum Entanglement

Quantum entanglement is one of the most fascinating and counterintuitive phenomena in quantum mechanics. When particles become entangled, their quantum states become correlated in ways that seem to defy classical physics.

## What is Entanglement?

Entanglement occurs when particles interact in such a way that the quantum state of each particle cannot be described independently of the others. Instead, we must describe the system as a whole.

## Key Properties

1. **Superposition**: Entangled particles exist in multiple states simultaneously until measured
2. **Correlation**: Measuring one particle instantly affects the state of its entangled partner
3. **Non-locality**: This correlation appears to happen faster than light could travel between particles

## Applications

- **Quantum Computing**: Exploits entanglement for parallel computation
- **Quantum Cryptography**: Uses entanglement for secure communication
- **Quantum Teleportation**: Transfers quantum states between particles

## Historical Context

Einstein famously called entanglement "spooky action at a distance" because he was uncomfortable with its implications. However, experiments have repeatedly confirmed that entanglement is real and follows the predictions of quantum mechanics.
`;

/**
 * Mock response for heading link mappings
 * Schema expects: { titles: string[] } - standalone titles for each heading
 * The service will create the actual markdown links from these titles
 */
export const headingLinkMappingsResponse = createMockOpenAIResponse(
  JSON.stringify({
    titles: [
      'Quantum Entanglement Definition',
      'Quantum Entanglement Properties',
      'Quantum Technology Applications',
      'History of Quantum Entanglement',
    ],
  })
);

/**
 * Mock response for key term link mappings
 * Schema expects: { titles: string[] } - standalone titles for each key term
 * The service will create the actual markdown links from these titles
 */
export const keyTermLinkMappingsResponse = createMockOpenAIResponse(
  JSON.stringify({
    titles: [
      'Quantum Superposition',
      'Quantum Correlation',
      'Non-locality in Physics',
      'Quantum Computing Technology',
      'Quantum Cryptography Security',
      'Quantum Teleportation Process',
    ],
  })
);

/**
 * Empty link mappings (no links found)
 * Schema expects: { titles: string[] }
 */
export const emptyLinkMappingsResponse = createMockOpenAIResponse(
  JSON.stringify({
    titles: [],
  })
);

/**
 * Complete explanation generation fixture for happy path testing
 */
export const completeExplanationFixture = {
  title: '[TEST] Understanding Quantum Entanglement',
  rawContent: fullExplanationContent,
  enhancedContent: `# [TEST] Understanding Quantum Entanglement

Quantum entanglement is one of the most fascinating and counterintuitive phenomena in quantum mechanics. When particles become entangled, their quantum states become correlated in ways that seem to defy classical physics.

## [What is Entanglement?](/standalone-title?t=Quantum%20Entanglement%20Definition)

Entanglement occurs when particles interact in such a way that the quantum state of each particle cannot be described independently of the others. Instead, we must describe the system as a whole.

## [Key Properties](/standalone-title?t=Quantum%20Entanglement%20Properties)

1. [Superposition](/standalone-title?t=Quantum%20Superposition): Entangled particles exist in multiple states simultaneously until measured
2. [Correlation](/standalone-title?t=Quantum%20Correlation): Measuring one particle instantly affects the state of its entangled partner
3. [Non-locality](/standalone-title?t=Non-locality%20in%20Physics): This correlation appears to happen faster than light could travel between particles

## [Applications](/standalone-title?t=Quantum%20Technology%20Applications)

- [Quantum Computing](/standalone-title?t=Quantum%20Computing%20Technology): Exploits entanglement for parallel computation
- [Quantum Cryptography](/standalone-title?t=Quantum%20Cryptography%20Security): Uses entanglement for secure communication
- [Quantum Teleportation](/standalone-title?t=Quantum%20Teleportation%20Process): Transfers quantum states between particles

## [Historical Context](/standalone-title?t=History%20of%20Quantum%20Entanglement)

Einstein famously called entanglement "spooky action at a distance" because he was uncomfortable with its implications. However, experiments have repeatedly confirmed that entanglement is real and follows the predictions of quantum mechanics.
`,
  tags: {
    difficultyLevel: 2,
    length: 5,
    simpleTags: [7, 8, 9],
  },
};
