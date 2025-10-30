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