// Mock for @anthropic-ai/sdk used in unit tests.
// Mirrors the Anthropic Messages API surface used by llms.ts and generate-article.ts.

export const mockAnthropicMessages = {
  create: jest.fn().mockResolvedValue({
    id: 'msg_mock_123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Mocked Anthropic response' }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
    },
  }),
  stream: jest.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mocked ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'stream response' } };
    },
    finalMessage: jest.fn().mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 200 },
    }),
  }),
};

export default class Anthropic {
  messages = mockAnthropicMessages;
}
