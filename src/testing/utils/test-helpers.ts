import { faker } from '@faker-js/faker';

/**
 * Test data builders for common entities
 */

export const createMockExplanation = (overrides = {}) => ({
  id: faker.string.uuid(),
  topic: faker.lorem.sentence(),
  explanation: faker.lorem.paragraph(),
  audience: 'general',
  background: faker.lorem.sentence(),
  userId: faker.string.uuid(),
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),
  ...overrides,
});

export const createMockTopic = (overrides = {}) => ({
  id: faker.string.uuid(),
  topic: faker.lorem.word(),
  description: faker.lorem.sentence(),
  createdAt: faker.date.recent(),
  ...overrides,
});

export const createMockTag = (overrides = {}) => ({
  id: faker.string.uuid(),
  name: faker.lorem.word(),
  color: faker.internet.color(),
  ...overrides,
});

export const createMockVector = (dimension = 1536) => {
  return Array.from({ length: dimension }, () => Math.random());
};

/**
 * Async test utilities
 */

export const waitForAsync = async (callback: () => boolean, timeout = 5000) => {
  const startTime = Date.now();
  while (!callback() && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!callback()) {
    throw new Error('Timeout waiting for condition');
  }
};

/**
 * Mock response builders
 */

// Zero usage so mocked LLM calls (integration tests run callLLM against the real dev DB with a
// mocked OpenAI SDK) record estimated_cost_usd = 0 — keeping the cost dashboard free of mock
// "phantom" spend. Model attribution is handled by callLLM's apiModel fallback, so no `model`
// field is hardcoded here (that would mis-record the model). Tests asserting a specific non-zero
// cost use their own inline `usage` objects, not this shared helper.
export const createMockOpenAIResponse = (content: string) => ({
  choices: [
    {
      message: {
        content,
        role: 'assistant',
      },
      index: 0,
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  },
});

export const createMockEmbeddingResponse = (vector: number[]) => ({
  data: [
    {
      embedding: vector,
      index: 0,
    },
  ],
  usage: {
    prompt_tokens: 50,
    total_tokens: 50,
  },
});

/**
 * Next.js API Route test utilities
 */

export const createMockNextRequest = (
  body: unknown,
  options: {
    headers?: Record<string, string>;
    method?: string;
  } = {}
) => {
  const { headers = {}, method = 'POST' } = options;

  return {
    json: jest.fn().mockResolvedValue(body),
    headers: new Map(Object.entries(headers)),
    method,
  };
};

/**
 * Stream testing utilities
 */

export const collectStreamData = async (stream: ReadableStream): Promise<string[]> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  return chunks;
};

export const parseSSEMessages = (chunks: string[]): unknown[] => {
  const messages: unknown[] = [];
  const fullText = chunks.join('');
  const lines = fullText.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.substring(6);
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return messages;
};