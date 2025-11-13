/**
 * LLM Response Fixtures
 *
 * Recorded OpenAI API responses for integration test validation.
 * These can be used as:
 * - Fallback fixtures when USE_REAL_API_CALLS=false
 * - Validation templates for response structure
 * - Examples for test data generation
 */

import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';

// ============================================
// TITLE GENERATION RESPONSES
// ============================================

export const titleGenerationResponse: ChatCompletion = {
  id: 'chatcmpl-test-title-123',
  object: 'chat.completion',
  created: Date.now(),
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Quantum Entanglement',
      },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 25,
    completion_tokens: 3,
    total_tokens: 28,
  },
  system_fingerprint: null,
};

export const titleGenerationResponseAlternate: ChatCompletion = {
  id: 'chatcmpl-test-title-456',
  object: 'chat.completion',
  created: Date.now(),
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Neural Networks and Deep Learning',
      },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 30,
    completion_tokens: 5,
    total_tokens: 35,
  },
  system_fingerprint: null,
};

// ============================================
// EXPLANATION GENERATION RESPONSES
// ============================================

export const explanationGenerationResponse: ChatCompletion = {
  id: 'chatcmpl-test-explanation-789',
  object: 'chat.completion',
  created: Date.now(),
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: `# Quantum Entanglement

## What is Quantum Entanglement?

Quantum entanglement is a physical phenomenon that occurs when a group of particles are generated, interact, or share spatial proximity in a way such that the quantum state of each particle of the group cannot be described independently of the state of the others.

## Key Characteristics

1. **Instantaneous Correlation**: When you measure one particle, you instantly know the state of the entangled partner
2. **Non-locality**: The correlation exists regardless of distance
3. **Cannot be used for faster-than-light communication**: Despite the instantaneous correlation

## Example

Imagine two coins that are entangled. When you flip one and it lands on heads, the other will always land on tails, no matter how far apart they are.

## Applications

- Quantum Computing
- Quantum Cryptography
- Quantum Teleportation

## Further Reading

- Einstein-Podolsky-Rosen Paradox
- Bell's Theorem
- Quantum Superposition`,
      },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 150,
    completion_tokens: 200,
    total_tokens: 350,
  },
  system_fingerprint: null,
};

// ============================================
// STREAMING RESPONSES
// ============================================

/**
 * Simulated streaming chunks for an explanation
 */
export const streamingExplanationChunks: ChatCompletionChunk[] = [
  {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '# ' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  },
  {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { content: 'Quantum ' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  },
  {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { content: 'Entanglement\n\n' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  },
  {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { content: 'Quantum entanglement is a phenomenon...' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  },
  {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  },
];

// ============================================
// TAG EVALUATION RESPONSES
// ============================================

export const tagEvaluationResponse: ChatCompletion = {
  id: 'chatcmpl-test-tags-999',
  object: 'chat.completion',
  created: Date.now(),
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({
          tags: ['physics', 'quantum-mechanics', 'advanced', 'theoretical'],
          confidence: 0.95,
        }),
      },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
  },
  system_fingerprint: null,
};

// ============================================
// EMBEDDING RESPONSES
// ============================================

/**
 * Generates a mock embedding vector of the correct dimension (1536 for text-embedding-3-small)
 */
export function generateMockEmbedding(seed: number = 0): number[] {
  const dimension = 1536;
  const embedding: number[] = [];

  for (let i = 0; i < dimension; i++) {
    // Generate deterministic values based on seed
    embedding.push(Math.sin(seed + i) * 0.5);
  }

  // Normalize to unit vector (as OpenAI does)
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

export const embeddingResponse = {
  object: 'list',
  data: [
    {
      object: 'embedding',
      index: 0,
      embedding: generateMockEmbedding(42),
    },
  ],
  model: 'text-embedding-3-small',
  usage: {
    prompt_tokens: 10,
    total_tokens: 10,
  },
};

// ============================================
// ERROR RESPONSES
// ============================================

export const rateLimitErrorResponse = {
  error: {
    message: 'Rate limit exceeded. Please try again later.',
    type: 'rate_limit_error',
    param: null,
    code: 'rate_limit_exceeded',
  },
};

export const invalidAPIKeyErrorResponse = {
  error: {
    message: 'Incorrect API key provided',
    type: 'invalid_request_error',
    param: null,
    code: 'invalid_api_key',
  },
};

export const contentFilterErrorResponse = {
  error: {
    message: 'Content filtered due to safety system',
    type: 'content_filter_error',
    param: null,
    code: 'content_filter',
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Creates a custom explanation response with provided content
 */
export function createExplanationResponse(content: string): ChatCompletion {
  return {
    id: `chatcmpl-test-${Date.now()}`,
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: content.length / 4, // Rough estimate
      total_tokens: 100 + content.length / 4,
    },
    system_fingerprint: null,
  };
}

/**
 * Creates a custom title response
 */
export function createTitleResponse(title: string): ChatCompletion {
  return {
    id: `chatcmpl-test-title-${Date.now()}`,
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: title,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 25,
      completion_tokens: title.split(' ').length,
      total_tokens: 25 + title.split(' ').length,
    },
    system_fingerprint: null,
  };
}

/**
 * Creates streaming chunks for given content
 */
export function createStreamingChunks(content: string): ChatCompletionChunk[] {
  const chunks: ChatCompletionChunk[] = [];
  const chunkSize = 10; // Characters per chunk
  const id = `chatcmpl-stream-${Date.now()}`;

  // First chunk with role
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '' },
        finish_reason: null,
        logprobs: null,
      },
    ],
  });

  // Content chunks
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push({
      id,
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { content: content.slice(i, i + chunkSize) },
          finish_reason: null,
          logprobs: null,
        },
      ],
    });
  }

  // Final chunk
  chunks.push({
    id,
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  });

  return chunks;
}
