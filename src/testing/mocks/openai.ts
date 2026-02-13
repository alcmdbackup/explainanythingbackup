// Error classes matching the real OpenAI SDK hierarchy for instanceof checks.
export class OpenAIError extends Error {}
export class APIError extends OpenAIError {
  readonly status: number | undefined;
  readonly headers: unknown;
  readonly error: unknown;
  constructor(status: number | undefined, error: unknown, message: string | undefined, headers: unknown) {
    super(message ?? 'Unknown error');
    this.status = status;
    this.headers = headers;
    this.error = error;
  }
}
export class APIConnectionError extends APIError {
  constructor({ message, cause }: { message?: string; cause?: Error }) {
    super(undefined, undefined, message ?? 'Connection error.', undefined);
    if (cause) (this as any).cause = cause;
  }
}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}
export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? 'Request timed out' });
  }
}

export const mockOpenAI = {
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Mocked OpenAI response',
              role: 'assistant',
            },
            index: 0,
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
      }),
    },
  },
  embeddings: {
    create: jest.fn().mockResolvedValue({
      data: [
        {
          embedding: Array(1536).fill(0.1),
          index: 0,
        },
      ],
      usage: {
        prompt_tokens: 50,
        total_tokens: 50,
      },
    }),
  },
};

export default class OpenAI {
  chat = mockOpenAI.chat;
  embeddings = mockOpenAI.embeddings;
}