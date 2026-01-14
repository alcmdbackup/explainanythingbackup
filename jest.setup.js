// Add custom Jest matchers from Testing Library
require('@testing-library/jest-dom');

// Mock environment variables for testing
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.PINECONE_API_KEY = 'test-pinecone-key';
process.env.PINECONE_INDEX_NAME_ALL = 'test-index';

// Polyfills for Node environment (required by langchain/langsmith)
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock ResizeObserver (required by shadcn UI components)
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Sentry for testing (includes new Logs API)
jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  withScope: jest.fn((callback) => callback({
    setTag: jest.fn(),
    setExtra: jest.fn(),
    setUser: jest.fn(),
    setLevel: jest.fn(),
    setContext: jest.fn(),
  })),
  startSpan: jest.fn((options, callback) => callback()),
  // Sentry Logs API (v9.41.0+)
  logger: {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    fmt: jest.fn((strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '')),
  },
  // Server Action instrumentation
  withServerActionInstrumentation: jest.fn((name, options, callback) => callback()),
}));

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