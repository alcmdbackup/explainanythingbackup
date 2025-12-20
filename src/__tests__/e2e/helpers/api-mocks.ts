import { Page } from '@playwright/test';

interface MockExplanationResponse {
  title: string;
  content: string;
  tags?: Array<{ tag_name: string; tag_type?: string }>;
  explanation_id?: string;
  userQueryId?: string;
}

/**
 * Mock the returnExplanation API to return a deterministic SSE stream.
 * This intercepts the POST to /api/returnExplanation and returns mocked events.
 */
export async function mockReturnExplanationAPI(
  page: Page,
  mockResponse: MockExplanationResponse
) {
  await page.route('**/api/returnExplanation', async (route) => {
    const events = createSSEEvents(mockResponse);

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: events,
    });
  });
}

/**
 * Mock the API to return an error response.
 */
export async function mockReturnExplanationAPIError(
  page: Page,
  errorMessage: string = 'Internal server error'
) {
  await page.route('**/api/returnExplanation', async (route) => {
    await route.fulfill({
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: errorMessage }),
    });
  });
}

/**
 * Mock the API to simulate a slow stream with delays.
 */
export async function mockReturnExplanationAPISlow(
  page: Page,
  mockResponse: MockExplanationResponse,
  delayMs: number = 100
) {
  await page.route('**/api/returnExplanation', async (route) => {
    const events = createSSEEventsWithDelay(mockResponse, delayMs);

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: events,
    });
  });
}

/**
 * Create Server-Sent Events string for mock streaming response.
 */
function createSSEEvents(response: MockExplanationResponse): string {
  const events: string[] = [];

  // 1. streaming_start event
  events.push(`data: ${JSON.stringify({ type: 'streaming_start' })}\n\n`);

  // 2. progress event with title
  events.push(`data: ${JSON.stringify({
    type: 'progress',
    stage: 'title_generated',
    title: response.title,
  })}\n\n`);

  // 3. content events (split content into chunks)
  const contentChunks = splitIntoChunks(response.content, 100);
  for (const chunk of contentChunks) {
    events.push(`data: ${JSON.stringify({
      type: 'content',
      content: chunk,
    })}\n\n`);
  }

  // 4. streaming_end event
  events.push(`data: ${JSON.stringify({ type: 'streaming_end' })}\n\n`);

  // 5. complete event with full result
  const completeResult = {
    success: true,
    explanation_id: response.explanation_id || 'test-explanation-123',
    userQueryId: response.userQueryId || 'test-query-456',
    title: response.title,
    content: response.content,
    tags: response.tags || [
      { tag_name: 'test-tag', tag_type: 'simple' },
    ],
  };

  events.push(`data: ${JSON.stringify({
    type: 'complete',
    result: completeResult,
  })}\n\n`);

  return events.join('');
}

/**
 * Create SSE events with delay markers (for debugging).
 */
function createSSEEventsWithDelay(
  response: MockExplanationResponse,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _delayMs: number
): string {
  // Same as createSSEEvents, but all at once (Playwright route.fulfill doesn't support streaming delays)
  return createSSEEvents(response);
}

/**
 * Split text into chunks of specified max size.
 */
function splitIntoChunks(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxSize) {
    chunks.push(text.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Default mock response for quick testing.
 */
export const defaultMockExplanation: MockExplanationResponse = {
  title: 'Understanding Quantum Entanglement',
  content: `# Understanding Quantum Entanglement

Quantum entanglement is a phenomenon in quantum physics where two or more particles become interconnected in such a way that the quantum state of each particle cannot be described independently.

## Key Concepts

1. **Superposition** - Particles can exist in multiple states simultaneously
2. **Measurement** - Observing one particle instantly affects its entangled partner
3. **Non-locality** - This effect occurs regardless of distance between particles

## Applications

- Quantum computing
- Quantum cryptography
- Quantum teleportation

This fascinating phenomenon challenges our classical understanding of physics and opens doors to revolutionary technologies.`,
  tags: [
    { tag_name: 'physics', tag_type: 'simple' },
    { tag_name: 'quantum-mechanics', tag_type: 'simple' },
    { tag_name: 'advanced', tag_type: 'preset' },
  ],
  explanation_id: 'mock-explanation-001',
  userQueryId: 'mock-query-001',
};

/**
 * Short mock response for quick tests.
 */
export const shortMockExplanation: MockExplanationResponse = {
  title: 'Brief Explanation',
  content: 'This is a short explanation for testing purposes.',
  tags: [{ tag_name: 'test', tag_type: 'simple' }],
  explanation_id: 'mock-short-001',
  userQueryId: 'mock-query-short-001',
};

/**
 * Mock library explanations for testing library page.
 */
export const mockLibraryExplanations = [
  {
    explanationid: 584,
    title: 'Understanding Quantum Entanglement',
    content: defaultMockExplanation.content,
    tags: [{ tag_name: 'physics' }, { tag_name: 'quantum' }],
    saved_timestamp: '2024-01-15T10:30:00Z',
  },
  {
    explanationid: 585,
    title: 'Machine Learning Basics',
    content: 'Machine learning is a subset of artificial intelligence...',
    tags: [{ tag_name: 'ai' }, { tag_name: 'ml' }],
    saved_timestamp: '2024-01-14T09:00:00Z',
  },
];

/**
 * Mock the user library API to return test explanations.
 * Intercepts Next.js server action calls to the userlibrary page.
 */
export async function mockUserLibraryAPI(
  page: Page,
  explanations = mockLibraryExplanations
) {
  await page.route('**/userlibrary', async (route, request) => {
    // Only intercept server action calls (POST with Next-Action header)
    if (request.method() === 'POST' && request.headers()['next-action']) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/x-component' },
        body: JSON.stringify(explanations),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock fetching a single explanation by ID.
 */
export async function mockExplanationByIdAPI(
  page: Page,
  explanation = mockLibraryExplanations[0]
) {
  await page.route('**/api/getExplanation**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        explanation: {
          ...explanation,
          content: explanation.content || defaultMockExplanation.content,
        },
      }),
    });
  });
}

/**
 * Mock the API to return a validation error (400).
 */
export async function mockReturnExplanationValidationError(
  page: Page,
  errorMessage: string = 'Missing required parameters'
) {
  await page.route('**/api/returnExplanation', async (route) => {
    await route.fulfill({
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: errorMessage }),
    });
  });
}

/**
 * Mock the API to timeout (never respond).
 * The route will hang indefinitely until the test times out.
 */
export async function mockReturnExplanationTimeout(page: Page) {
  await page.route('**/api/returnExplanation', async () => {
    // Don't call route.fulfill() - this will cause the request to hang
    await new Promise(() => {
      // Never resolves - simulates network timeout
    });
  });
}

/**
 * Mock the API to return an SSE stream error mid-stream.
 */
export async function mockReturnExplanationStreamError(
  page: Page,
  errorMessage: string = 'Stream interrupted'
) {
  await page.route('**/api/returnExplanation', async (route) => {
    const events: string[] = [];

    // Start streaming normally
    events.push(`data: ${JSON.stringify({ type: 'streaming_start' })}\n\n`);
    events.push(`data: ${JSON.stringify({
      type: 'progress',
      stage: 'title_generated',
      title: 'Partial Title',
    })}\n\n`);

    // Then send error event
    events.push(`data: ${JSON.stringify({
      type: 'error',
      error: errorMessage,
    })}\n\n`);

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: events.join(''),
    });
  });
}
