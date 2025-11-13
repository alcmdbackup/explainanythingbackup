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
