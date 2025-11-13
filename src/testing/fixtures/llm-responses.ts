/**
 * LLM Response Fixtures for Integration Testing
 *
 * Realistic mock responses for OpenAI API calls
 * Reuses and extends test-helpers.ts mock builders
 */

import { createMockOpenAIResponse } from '../utils/test-helpers';

/**
 * Mock response for title generation
 */
export const titleGenerationResponse = createMockOpenAIResponse(
  JSON.stringify({
    title: 'Understanding Quantum Entanglement',
  })
);

/**
 * Mock response for explanation generation (non-streaming)
 */
export const explanationGenerationResponse = createMockOpenAIResponse(
  JSON.stringify({
    content: `# Understanding Quantum Entanglement

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
  '# Understanding',
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
 */
export const tagEvaluationResponse = createMockOpenAIResponse(
  JSON.stringify({
    tags: [
      { tag_name: 'quantum-physics', confidence: 0.95 },
      { tag_name: 'advanced', confidence: 0.85 },
      { tag_name: 'theoretical', confidence: 0.90 },
    ],
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
export const fullExplanationContent = `# Understanding Quantum Entanglement

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
