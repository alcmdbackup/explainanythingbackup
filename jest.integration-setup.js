// Integration test setup - runs after Jest environment is set up
// This is for integration tests that test cross-service interactions

// Load test environment variables
require('dotenv').config({ path: '.env.test' });

// Add custom Jest matchers (still useful for integration tests)
require('@testing-library/jest-dom');

// Polyfills for Node environment (required by langchain/langsmith)
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// For integration tests, we need real fetch to connect to Supabase
// Use node-fetch or undici for Node.js environment
// Check if fetch is already available (Node 18+)
if (typeof global.fetch === 'undefined') {
  // For older Node versions, you may need to install node-fetch
  // For now, we'll just set it to a function that errors if used
  console.warn('fetch is not available in this Node version. Please use Node 18+ or install node-fetch');
}

// Mock Next.js router (still needed for some integration tests)
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Next.js headers and cookies for integration tests
// Service functions use createSupabaseServerClient() which needs cookies()
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({
    getAll: jest.fn(() => []),
    get: jest.fn(() => undefined),
    set: jest.fn(),
    delete: jest.fn(),
  })),
  headers: jest.fn(() => Promise.resolve({
    get: jest.fn(() => null),
  })),
}));

// Global mock for Pinecone - can be overridden in individual test files
// This prevents module-level instantiation from failing
jest.mock('@pinecone-database/pinecone', () => {
  const mockQuery = jest.fn();
  const mockUpsert = jest.fn();
  const mockFetch = jest.fn();

  const namespaceObj = {
    query: mockQuery,
    upsert: mockUpsert,
    fetch: mockFetch,
  };

  // Create stable index and namespace functions that persist across clearAllMocks
  const mockNamespace = jest.fn().mockReturnValue(namespaceObj);
  const indexObj = {
    namespace: mockNamespace,
  };

  // Create stable index function
  const mockIndexFn = jest.fn().mockReturnValue(indexObj);

  // Create stable Pinecone instance - same instance returned every time
  const pineconeInstance = {
    // Support both uppercase Index (old API) and lowercase index (current API)
    Index: mockIndexFn,
    index: mockIndexFn,
  };

  return {
    Pinecone: jest.fn().mockImplementation(() => pineconeInstance),
    RecordValues: {},
    __mockQuery: mockQuery,
    __mockUpsert: mockUpsert,
    __mockFetch: mockFetch,
    __mockNamespace: mockNamespace,
    __mockIndexFn: mockIndexFn,
  };
});

// Global mock for OpenAI - can be overridden in individual test files
jest.mock('openai', () => {
  const mockEmbeddingsCreate = jest.fn();
  const mockChatCreate = jest.fn();

  const MockOpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockEmbeddingsCreate,
    },
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  }));

  // Export mock functions for test access
  MockOpenAI.__mockEmbeddingsCreate = mockEmbeddingsCreate;
  MockOpenAI.__mockChatCreate = mockChatCreate;

  return {
    __esModule: true,
    default: MockOpenAI,
  };
});

// Mock Supabase server client to use service role client for integration tests
// This bypasses RLS and uses a properly initialized client with all methods
jest.mock('@/lib/utils/supabase/server', () => {
  const { createClient } = require('@supabase/supabase-js');

  return {
    createSupabaseServerClient: jest.fn(() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !serviceRoleKey) {
        throw new Error('Missing Supabase credentials in integration test environment');
      }

      return Promise.resolve(createClient(url, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }));
    }),
    createSupabaseServiceClient: jest.fn(() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !serviceRoleKey) {
        throw new Error('Missing Supabase credentials in integration test environment');
      }

      return Promise.resolve(createClient(url, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }));
    }),
  };
});

// Integration test specific configuration
console.log('Integration test environment loaded');
console.log('- PINECONE_NAMESPACE:', process.env.PINECONE_NAMESPACE);
console.log('- NODE_ENV:', process.env.NODE_ENV);

// Suppress console errors in tests (optional, remove if you want to see errors)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Global integration test lifecycle hooks
// These will be augmented by individual test files as needed
console.log('Jest integration setup complete');
