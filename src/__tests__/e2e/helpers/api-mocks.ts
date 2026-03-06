import { Page } from '@playwright/test';
import * as fs from 'fs';

// Path to production test data file (written by global-setup, read by tests)
export const PROD_TEST_DATA_PATH = '/tmp/e2e-prod-test-data.json';

/**
 * Load production test data if available.
 * Returns null in non-production or if file doesn't exist.
 */
export function loadProductionTestData(): { explanationId: number; title: string } | null {
  try {
    if (!fs.existsSync(PROD_TEST_DATA_PATH)) return null;
    return JSON.parse(fs.readFileSync(PROD_TEST_DATA_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if running against production environment.
 */
export function isProductionEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || '';
  return baseUrl.includes('vercel.app') || baseUrl.includes('explainanything');
}

interface MockExplanationResponse {
  title: string;
  content: string;
  tags?: Array<{ tag_name: string; tag_type?: string }>;
  // Use numeric IDs to match the production API and client expectations
  explanation_id?: number;
  userQueryId?: number;
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
  // NOTE: Client expects 'explanationId' (camelCase), not 'explanation_id' (snake_case)
  // See src/app/results/page.tsx line ~434 where it destructures: { explanationId, userQueryId }
  const completeResult = {
    success: true,
    explanationId: response.explanation_id || 12345,
    userQueryId: response.userQueryId || 67890,
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
  explanation_id: 90001,
  userQueryId: 91001,
};

/**
 * Short mock response for quick tests.
 */
export const shortMockExplanation: MockExplanationResponse = {
  title: 'Brief Explanation',
  content: 'This is a short explanation for testing purposes.',
  tags: [{ tag_name: 'test', tag_type: 'simple' }],
  explanation_id: 90002,
  userQueryId: 91002,
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
  console.log('[MOCK-DEBUG] Registering stream error mock for:', errorMessage);

  await page.route('**/api/returnExplanation', async (route) => {
    console.log('[MOCK-DEBUG] Route handler invoked for returnExplanation');
    console.log('[MOCK-DEBUG] Request URL:', route.request().url());
    console.log('[MOCK-DEBUG] Request method:', route.request().method());

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

    console.log('[MOCK-DEBUG] Fulfilling with', events.length, 'SSE events');
    console.log('[MOCK-DEBUG] Events:', events.map(e => e.replace(/\n/g, '\\n')));

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: events.join(''),
    });

    console.log('[MOCK-DEBUG] Route fulfilled successfully');
  });

  console.log('[MOCK-DEBUG] Route registered for **/api/returnExplanation');
}

// ============= AI Suggestions Pipeline Mocks =============
// NOTE: Server-side LLM mocking is not possible with Playwright as the OpenAI SDK
// makes requests from the Node.js server, not from the browser.
// For diff visualization tests, use integration tests instead (see promptSpecific.integration.test.tsx)

interface MockAISuggestionsOptions {
  content?: string;
  success?: boolean;
  error?: string;
  delay?: number;
  session_id?: string;
}

/**
 * Mock the AI suggestions pipeline API route.
 * This mocks the test-only API route `/api/runAISuggestionsPipeline` which returns standard JSON.
 * Use this for E2E tests that need to test diff visualization and accept/reject interactions.
 */
export async function mockAISuggestionsPipelineAPI(
  page: Page,
  options: MockAISuggestionsOptions
) {
  await page.route('**/api/runAISuggestionsPipeline', async (route) => {
    if (options.delay) {
      await new Promise(r => setTimeout(r, options.delay));
    }

    const response = options.success === false
      ? { success: false, error: options.error || 'Pipeline failed' }
      : {
          success: true,
          content: options.content,
          session_id: options.session_id || 'test-session-123',
        };

    await route.fulfill({
      status: options.success === false ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });
  });
}

/**
 * @deprecated Use mockOpenAIAPI instead for the hybrid approach.
 *
 * Mock the AI suggestions pipeline server action.
 * This doesn't work reliably because Next.js server actions use RSC wire format.
 */
export async function mockAISuggestionsPipeline(
  page: Page,
  options: MockAISuggestionsOptions
) {
  // Server actions POST to the results page with Next-Action header
  // Use URL pattern matching but filter by request properties in the handler
  // Note: '**/results**' matches URLs with query params like '/results?q=...'
  await page.route('**/results**', async (route, request) => {
    const nextAction = request.headers()['next-action'];
    const isServerAction = request.method() === 'POST' && nextAction;

    if (!isServerAction) {
      await route.continue();
      return;
    }

    if (options.delay) {
      await new Promise(r => setTimeout(r, options.delay));
    }

    const response = options.success === false
      ? { success: false, error: options.error || 'Pipeline failed' }
      : {
          success: true,
          content: options.content,
          session_id: options.session_id || 'test-session-123',
        };

    // Server actions return RSC format (text/x-component)
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/x-component' },
      body: JSON.stringify(response),
    });
  });
}

/**
 * Pre-built mock responses for generic diff cases.
 */
export const mockDiffContent = {
  insertion: `# Title

This is {++newly added++} content.`,

  deletion: `# Title

This is {--removed--} content that remains.`,

  update: `# Title

This is {--old--}{++new++} content.`,

  mixed: `# Title

{++Added paragraph.++}

This has {--deleted--} and {--changed--}{++updated++} words.`,
};

/**
 * Pre-built mock responses for prompt-specific cases.
 * These match the fixtures in AI_PIPELINE_FIXTURES.promptSpecific
 */
export const mockPromptSpecificContent = {
  removeFirstSentence: `# Understanding Quantum Physics

{--This introductory sentence is outdated. --}Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,

  shortenFirstParagraph: `# Machine Learning Basics

{--Machine learning is a subset of artificial intelligence that focuses on building systems that can learn from data. These systems improve their performance over time without being explicitly programmed. The field has grown significantly in recent years due to advances in computing power and the availability of large datasets.--}{++Machine learning builds systems that learn from data and improve over time without explicit programming.++}

## Types of Learning

Supervised learning uses labeled data to train models.`,

  improveEntireArticle: `# {--Climate Change--}{++Understanding Climate Change++}

{--Climate change is bad. It makes things hotter. The ice is melting and that's not good.--}{++Climate change refers to long-term shifts in global temperatures and weather patterns. Rising greenhouse gas emissions have accelerated warming trends since the industrial era.++}

## {--Effects--}{++Environmental and Social Effects++}

{--There are many effects. Some are bad for animals. Some are bad for people.--}{++The consequences of climate change are far-reaching. Ecosystems face disruption as species struggle to adapt. Human communities experience increased extreme weather events, threatening food security and infrastructure.++}`,
};
