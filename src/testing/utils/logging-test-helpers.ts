/**
 * Test utilities for logging infrastructure testing
 * Provides mock factories for LogConfig, TracingConfig, logger, spans, and test functions
 */

import { faker } from '@faker-js/faker';
import type { LogConfig, TracingConfig } from '@/lib/schemas/schemas';
import type { Span } from '@opentelemetry/api';

// ============================================================================
// Config Mock Factories
// ============================================================================

/**
 * Creates a mock LogConfig for testing
 */
export const createMockLogConfig = (overrides: Partial<LogConfig> = {}): LogConfig => ({
  enabled: true,
  logInputs: true,
  logOutputs: true,
  logErrors: true,
  maxInputLength: 1000,
  maxOutputLength: 1000,
  sensitiveFields: ['password', 'apiKey', 'token', 'secret', 'pass'],
  ...overrides,
});

/**
 * Creates a mock TracingConfig for testing
 * Note: TracingConfig uses literal types from `as const`, so we need a more relaxed type for overrides
 */
export const createMockTracingConfig = (overrides: {
  enabled?: boolean;
  tracerName?: 'app' | 'llm' | 'db' | 'vector';
  includeInputs?: boolean;
  includeOutputs?: boolean;
  customAttributes?: Record<string, string | number>;
} = {}): TracingConfig => ({
  enabled: true,
  tracerName: 'app',
  includeInputs: false,
  includeOutputs: false,
  customAttributes: {},
  ...overrides,
} as TracingConfig);

// ============================================================================
// Logger Mock Factory
// ============================================================================

/**
 * Creates a mocked logger for testing
 */
export const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

// ============================================================================
// OpenTelemetry Span Mock Factory
// ============================================================================

/**
 * Creates a mocked OpenTelemetry span for testing
 */
export const createMockSpan = (): jest.Mocked<Span> => ({
  spanContext: jest.fn().mockReturnValue({
    traceId: faker.string.uuid(),
    spanId: faker.string.uuid(),
    traceFlags: 1,
  }),
  setAttribute: jest.fn(),
  setAttributes: jest.fn(),
  addEvent: jest.fn(),
  setStatus: jest.fn(),
  updateName: jest.fn(),
  end: jest.fn(),
  isRecording: jest.fn().mockReturnValue(true),
  recordException: jest.fn(),
} as unknown as jest.Mocked<Span>);

// ============================================================================
// Test Function Generators
// ============================================================================

type TestFunctionBehavior = 'success' | 'error' | 'async-success' | 'async-error';

/**
 * Creates a test function with specified behavior
 */
export const createTestFunction = (
  name: string,
  behavior: TestFunctionBehavior,
  returnValue?: unknown
) => {
  const fn = (...args: unknown[]) => {
    switch (behavior) {
      case 'success':
        return returnValue ?? `${name} result`;
      case 'error':
        throw new Error(`${name} error`);
      case 'async-success':
        return Promise.resolve(returnValue ?? `${name} async result`);
      case 'async-error':
        return Promise.reject(new Error(`${name} async error`));
      default:
        return returnValue;
    }
  };

  Object.defineProperty(fn, 'name', { value: name, writable: false });
  return fn;
};

/**
 * Creates a synchronous function that succeeds
 */
export const createSyncSuccessFunction = (name = 'testFunction', returnValue: unknown = 'success') =>
  createTestFunction(name, 'success', returnValue);

/**
 * Creates a synchronous function that throws an error
 */
export const createSyncErrorFunction = (name = 'testFunction') =>
  createTestFunction(name, 'error');

/**
 * Creates an async function that resolves
 */
export const createAsyncSuccessFunction = (name = 'testFunction', returnValue: unknown = 'async success') =>
  createTestFunction(name, 'async-success', returnValue);

/**
 * Creates an async function that rejects
 */
export const createAsyncErrorFunction = (name = 'testFunction') =>
  createTestFunction(name, 'async-error');

// ============================================================================
// Log Call Capture Utilities
// ============================================================================

export interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/**
 * Captures all log calls from a mocked logger
 */
export const captureLogCalls = (logger: ReturnType<typeof createMockLogger>): LogCall[] => {
  const calls: LogCall[] = [];

  (['debug', 'info', 'warn', 'error'] as const).forEach(level => {
    const mockCalls = logger[level].mock.calls;
    mockCalls.forEach(call => {
      calls.push({
        level,
        message: call[0] as string,
        data: call[1],
      });
    });
  });

  return calls;
};

/**
 * Finds log calls by message substring
 */
export const findLogCalls = (
  logger: ReturnType<typeof createMockLogger>,
  messageSubstring: string
): LogCall[] => {
  return captureLogCalls(logger).filter(call =>
    call.message.includes(messageSubstring)
  );
};

/**
 * Asserts that a specific log call was made
 */
export const expectLogCall = (
  logger: ReturnType<typeof createMockLogger>,
  level: 'debug' | 'info' | 'warn' | 'error',
  messageSubstring: string
) => {
  const calls = logger[level].mock.calls;
  const found = calls.some(call => (call[0] as string).includes(messageSubstring));
  expect(found).toBe(true);
};

// ============================================================================
// Data Sanitization Test Utilities
// ============================================================================

/**
 * Creates test data with sensitive fields
 */
export const createSensitiveTestData = () => ({
  username: faker.internet.username(),
  password: faker.internet.password(),
  email: faker.internet.email(),
  apiKey: faker.string.uuid(),
  token: faker.string.alphanumeric(32),
  secret: faker.string.alphanumeric(16),
  normalField: faker.lorem.sentence(),
  nested: {
    password: faker.internet.password(),
    data: faker.lorem.word(),
  },
});

/**
 * Creates test data of various sizes for truncation testing
 */
export const createLargeTestData = (size: 'small' | 'medium' | 'large' | 'xlarge' = 'medium') => {
  const sizes = {
    small: 50,
    medium: 500,
    large: 2000,
    xlarge: 10000,
  };

  const length = sizes[size];
  return {
    data: faker.string.alpha(length),
    array: Array.from({ length: Math.min(100, length / 10) }, () => faker.lorem.word()),
    nested: {
      longString: faker.string.alpha(length),
      moreData: faker.lorem.paragraphs(Math.min(10, length / 100)),
    },
  };
};

/**
 * Expects that data has been sanitized (sensitive fields removed/redacted)
 */
export const expectSanitizedData = (logged: unknown, sensitiveFields: string[]) => {
  if (typeof logged !== 'object' || logged === null) return;

  const loggedObj = logged as Record<string, unknown>;

  sensitiveFields.forEach(field => {
    Object.keys(loggedObj).forEach(key => {
      if (key.toLowerCase().includes(field.toLowerCase())) {
        expect(loggedObj[key]).toBe('[REDACTED]');
      }
    });
  });
};

/**
 * Expects that data has been truncated
 */
export const expectTruncatedData = (value: string, maxLength: number) => {
  if (value.endsWith('...')) {
    expect(value.length).toBeLessThanOrEqual(maxLength + 3); // +3 for '...'
  } else {
    expect(value.length).toBeLessThanOrEqual(maxLength);
  }
};

// ============================================================================
// Module/Function Mock Utilities
// ============================================================================

/**
 * Creates mock module exports for testing module interception
 */
export const createMockModuleExports = (functions: Record<string, () => unknown> = {}) => {
  const defaultExport = jest.fn(() => 'default export result');

  return {
    default: defaultExport,
    ...functions,
  };
};

/**
 * Creates a mock Node.js module with exports
 */
export const createMockModule = (modulePath: string, exports: unknown) => ({
  id: modulePath,
  exports,
  parent: null,
  filename: modulePath,
  loaded: true,
  children: [],
  paths: [],
});

// ============================================================================
// Promise Chain Mock Utilities
// ============================================================================

/**
 * Creates a promise chain for testing runtime wrapping
 */
export const createMockPromiseChain = () => {
  const results: string[] = [];

  return Promise.resolve('initial')
    .then((value) => {
      results.push(value);
      return 'step1';
    })
    .then((value) => {
      results.push(value);
      return 'step2';
    })
    .then((value) => {
      results.push(value);
      return { results, final: value };
    });
};

/**
 * Creates a promise that rejects for testing error handling
 */
export const createRejectingPromise = (errorMessage = 'Promise rejected') => {
  return Promise.reject(new Error(errorMessage));
};

// ============================================================================
// Framework Detection Test Data
// ============================================================================

/**
 * Creates a function string that looks like React/Next.js framework code
 */
export const createFrameworkFunctionString = (type: 'react' | 'nextjs' | 'webpack' | 'native') => {
  const templates = {
    react: 'function Component() { /* react/dist/cjs/react.js */ }',
    nextjs: 'function handler() { /* next/dist/server/lib/router */ }',
    webpack: 'function __webpack_require__() { /* webpack/runtime */ }',
    native: 'function nativeFunction() { [native code] }',
  };

  return templates[type];
};

/**
 * Creates a user application function string
 */
export const createUserFunctionString = () => {
  return `function userFunction(arg1, arg2) {
    // User application code from @/lib/services
    return arg1 + arg2;
  }`;
};

// ============================================================================
// BigInt Test Data
// ============================================================================

/**
 * Creates test data with BigInt values for serialization testing
 */
export const createBigIntTestData = () => ({
  regularNumber: 12345,
  bigIntValue: BigInt('9007199254740991'),
  nested: {
    anotherBigInt: BigInt('123456789012345678901234567890'),
    normalField: 'test',
  },
  arrayWithBigInt: [1, BigInt('999'), 'string'],
});

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Mocks Date.now() for duration testing
 */
export const mockDateNow = (startTime = 1000) => {
  let currentTime = startTime;

  const originalDateNow = Date.now;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

  return {
    advance: (ms: number) => {
      currentTime += ms;
    },
    reset: () => {
      currentTime = startTime;
    },
    restore: () => {
      jest.spyOn(Date, 'now').mockRestore();
    },
  };
};

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Resets all mocks in a logger
 */
export const resetLoggerMocks = (logger: ReturnType<typeof createMockLogger>) => {
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
};

/**
 * Clears all mock calls without resetting implementations
 */
export const clearLoggerMocks = (logger: ReturnType<typeof createMockLogger>) => {
  logger.debug.mockClear();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
};
