type ScenarioName = 'default' | 'slow' | 'error' | 'mid_stream_error';

interface SSEEvent {
  type: 'streaming_start' | 'progress' | 'content' | 'streaming_end' | 'complete' | 'error';
  [key: string]: unknown;
}

interface Scenario {
  delayMs: number;
  events: SSEEvent[];
}

// Counter for generating incrementing mock IDs
let mockExplanationIdCounter = 90000;

// Generate a mock result that matches production schema
function createMockResult() {
  const explanationId = mockExplanationIdCounter++;
  return {
    originalUserInput: 'test query',
    match_found: false,
    error: null,
    explanationId: explanationId, // Required for redirect after streaming
    matches: [],
    data: {
      id: explanationId,
      title: 'Test Explanation Title',
      content: '<p>This is mock explanation content for E2E testing.</p>',
      topic: 'Test Topic',
      isMatch: false,
      matchScore: 0,
    },
    userQueryId: explanationId + 1000,
    is_saved: false,
  };
}

const scenarios: Record<ScenarioName, Scenario> = {
  default: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      {
        type: 'progress',
        stage: 'searching_matches',  // Use 'stage' to match client expectations (page.tsx:389)
        message: 'Searching for matches...',
        isStreaming: true,
        isComplete: false,
      },
      {
        type: 'progress',
        stage: 'title_generated',  // Send title during streaming for UI display
        title: 'Test Explanation Title',
        isStreaming: true,
        isComplete: false,
      },
      { type: 'content', content: '<p>This is mock ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'explanation content ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'for E2E testing.</p>', isStreaming: true, isComplete: false },
      { type: 'streaming_end', isStreaming: false },
      { type: 'complete', result: createMockResult(), isStreaming: false, isComplete: true },
    ],
  },
  slow: {
    delayMs: 200, // 200ms between events to test loading states
    events: [
      { type: 'streaming_start', isStreaming: true },
      {
        type: 'progress',
        stage: 'searching_matches',
        message: 'Searching...',
        isStreaming: true,
        isComplete: false,
      },
      {
        type: 'progress',
        stage: 'title_generated',
        title: 'Test Explanation Title',
        isStreaming: true,
        isComplete: false,
      },
      {
        type: 'content',
        content: '<p>Slow content chunk...</p>',
        isStreaming: true,
        isComplete: false,
      },
      { type: 'streaming_end', isStreaming: false },
      { type: 'complete', result: createMockResult(), isStreaming: false, isComplete: true },
    ],
  },
  error: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      {
        type: 'error',
        error: 'Test error: Something went wrong',
        isStreaming: false,
        isComplete: true,
      },
    ],
  },
  mid_stream_error: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      {
        type: 'progress',
        stage: 'title_generated',
        title: 'Test Explanation Title',
        isStreaming: true,
        isComplete: false,
      },
      {
        type: 'content',
        content: '<p>Partial content before ',
        isStreaming: true,
        isComplete: false,
      },
      { type: 'error', error: 'Connection lost mid-stream', isStreaming: false, isComplete: true },
    ],
  },
};

/**
 * Detects which scenario to use based on request headers or user input.
 *
 * Priority:
 * 1. X-Test-Scenario header
 * 2. Keyword detection in user input
 * 3. Default scenario
 */
function detectScenario(request: Request, userInput?: string): Scenario {
  // Priority 1: Explicit header
  const headerScenario = request.headers.get('X-Test-Scenario') as ScenarioName | null;
  if (headerScenario && scenarios[headerScenario]) {
    return scenarios[headerScenario];
  }

  // Priority 2: Keyword detection in user input
  const input = userInput?.toLowerCase() ?? '';
  if (input.includes('trigger-error')) return scenarios.error;
  if (input.includes('trigger-slow')) return scenarios.slow;
  if (input.includes('trigger-mid-error')) return scenarios.mid_stream_error;

  return scenarios.default;
}

/**
 * Streams mock SSE response for E2E testing.
 * This bypasses the real returnExplanation logic to provide reliable,
 * predictable streaming behavior for tests.
 */
export async function streamMockResponse(request: Request): Promise<Response> {
  let body: { userInput?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty or malformed body - use default scenario
  }
  const scenario = detectScenario(request, body.userInput);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (const event of scenario.events) {
        await new Promise((r) => setTimeout(r, scenario.delayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8', // Match production
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
