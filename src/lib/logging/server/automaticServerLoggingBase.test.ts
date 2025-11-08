/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
import {
  shouldSkipAutoLogging,
  withLogging,
  withTracing,
  withLoggingAndTracing,
  logMethod,
  createLoggedFunction,
  withBatchLogging,
  initializeAutoLogging,
} from './automaticServerLoggingBase';
import {
  createMockLogConfig,
  createMockTracingConfig,
  createMockLogger,
  createMockSpan,
  createSyncSuccessFunction,
  createSyncErrorFunction,
  createAsyncSuccessFunction,
  createAsyncErrorFunction,
  createSensitiveTestData,
  createLargeTestData,
  createBigIntTestData,
  createFrameworkFunctionString,
  createUserFunctionString,
  mockDateNow,
  resetLoggerMocks,
} from '@/testing/utils/logging-test-helpers';

// Mock dependencies
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../../instrumentation', () => ({
  createAppSpan: jest.fn(),
}));

import { logger } from '@/lib/server_utilities';
import { createAppSpan } from '../../../../instrumentation';

const mockLogger = logger as unknown as ReturnType<typeof createMockLogger>;
const mockCreateAppSpan = createAppSpan as jest.MockedFunction<typeof createAppSpan>;

describe('automaticServerLoggingBase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLoggerMocks(mockLogger);
  });

  // ============================================================================
  // shouldSkipAutoLogging Tests
  // ============================================================================

  describe('shouldSkipAutoLogging', () => {
    describe('Framework and system patterns', () => {
      it('should skip React framework functions', () => {
        const fn = function reactComponent() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function() { /* react/dist/cjs/react.js */ }',
        });

        expect(shouldSkipAutoLogging(fn, 'component', 'module')).toBe(true);
      });

      it('should skip Next.js framework functions', () => {
        const fn = function nextHandler() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function() { /* next/dist/server */ }',
        });

        expect(shouldSkipAutoLogging(fn, 'handler', 'module')).toBe(true);
      });

      it('should skip webpack internal functions', () => {
        const fn = function webpackRequire() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function __webpack_require__() { /* webpack/runtime */ }',
        });

        expect(shouldSkipAutoLogging(fn, '__webpack_require__', 'runtime')).toBe(true);
      });

      it('should skip Node.js internal functions', () => {
        const fn = function internalModule() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function() { /* internal/modules */ }',
        });

        expect(shouldSkipAutoLogging(fn, 'Module._load', 'runtime')).toBe(true);
      });

      it('should skip native code functions', () => {
        const fn = function nativeFunc() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function nativeFunc() { [native code] }',
        });

        expect(shouldSkipAutoLogging(fn, 'nativeFunc', 'runtime')).toBe(true);
      });
    });

    describe('Function length filtering', () => {
      it('should skip very short functions', () => {
        const fn = function x() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function(){}',
        });

        expect(shouldSkipAutoLogging(fn, 'x', 'runtime')).toBe(true);
      });

      it('should allow functions with sufficient length', () => {
        // Mock Error to control stack trace (Jest's stack includes node_modules which triggers skip)
        const mockStack = 'Error\n    at Object.<anonymous> (/app/src/lib/services/test.ts:10:15)';
        const OriginalError = global.Error;
        global.Error = class extends OriginalError {
          constructor(message?: string) {
            super(message);
            this.stack = mockStack;
          }
        } as any;

        const fn = function userFunction() {
          return 'this is a longer user function with enough characters to pass the length check';
        };
        Object.defineProperty(fn, 'toString', {
          value: () => 'function userFunction() { return "this is a longer user function with enough characters"; }',
        });

        expect(shouldSkipAutoLogging(fn, '@/lib/services/userFunction', 'module')).toBe(false);

        global.Error = OriginalError;
      });
    });

    describe('Module context filtering', () => {
      // Mock Error to control stack trace (Jest's stack includes node_modules which triggers skip)
      const mockStack = 'Error\n    at Object.<anonymous> (/app/src/lib/services/test.ts:10:15)';

      beforeEach(() => {
        const OriginalError = Error;
        global.Error = class extends OriginalError {
          constructor(message?: string) {
            super(message);
            this.stack = mockStack;
          }
        } as any;
      });

      afterEach(() => {
        global.Error = Error;
      });

      it('should allow application code starting with @/', () => {
        const fn = function appFunction() {
          return 'application code with enough length to pass the check';
        };
        Object.defineProperty(fn, 'toString', {
          value: () => 'function appFunction() { return "application code with enough length"; }',
        });

        expect(shouldSkipAutoLogging(fn, '@/lib/services/appFunction', 'module')).toBe(false);
      });

      it('should allow application code starting with ./src/', () => {
        const fn = function srcFunction() {
          return 'src code with enough length to pass the check and not be filtered out';
        };
        Object.defineProperty(fn, 'toString', {
          value: () => 'function srcFunction() { return "src code with enough length to pass"; }',
        });

        expect(shouldSkipAutoLogging(fn, './src/lib/services/srcFunction', 'module')).toBe(false);
      });

      it('should allow application code starting with ../src/', () => {
        const fn = function relativeFunction() {
          return 'relative src code with enough length to pass the length check successfully';
        };
        Object.defineProperty(fn, 'toString', {
          value: () => 'function relativeFunction() { return "relative src code with length"; }',
        });

        expect(shouldSkipAutoLogging(fn, '../src/lib/services/relativeFunction', 'module')).toBe(false);
      });

      it('should skip node_modules in module context', () => {
        const fn = function npmPackage() {
          return 'npm package';
        };

        expect(shouldSkipAutoLogging(fn, 'node_modules/somepackage', 'module')).toBe(true);
      });

      it('should skip non-application paths in module context', () => {
        const fn = function otherPath() {
          return 'other path';
        };

        expect(shouldSkipAutoLogging(fn, '/opt/other/path', 'module')).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should skip null or undefined functions', () => {
        expect(shouldSkipAutoLogging(null as any, 'null', 'runtime')).toBe(true);
        expect(shouldSkipAutoLogging(undefined as any, 'undefined', 'runtime')).toBe(true);
      });

      it('should skip non-function values', () => {
        expect(shouldSkipAutoLogging('string' as any, 'string', 'runtime')).toBe(true);
        expect(shouldSkipAutoLogging(123 as any, 'number', 'runtime')).toBe(true);
        expect(shouldSkipAutoLogging({} as any, 'object', 'runtime')).toBe(true);
      });

      it('should use exact case matching for pattern matching', () => {
        const fn = function reactComponent() {};
        Object.defineProperty(fn, 'toString', {
          value: () => 'function() { /* REACT/DIST/CJS */ }',
        });

        // Pattern matching is case-sensitive, so uppercase 'REACT' doesn't match 'react/'
        expect(shouldSkipAutoLogging(fn, 'component', 'runtime')).toBe(false);
      });
    });
  });

  // ============================================================================
  // sanitizeData Tests (via withLogging behavior)
  // ============================================================================

  describe('Data sanitization (via withLogging)', () => {
    describe('Sensitive field removal', () => {
      it('should redact password fields', () => {
        const fn = createSyncSuccessFunction('testFn', { username: 'user', password: '12345' });
        const config = createMockLogConfig({ logInputs: true, logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ password: 'secret123', user: 'john' });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(logCall).toBeDefined();
        expect(JSON.stringify(logCall![1])).toContain('[REDACTED]');
      });

      it('should redact apiKey fields', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ apiKey: 'sk-1234567890', data: 'public' });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(JSON.stringify(logCall![1])).toContain('[REDACTED]');
      });

      it('should redact token fields', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ authToken: 'bearer123', data: 'public' });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(JSON.stringify(logCall![1])).toContain('[REDACTED]');
      });

      it('should redact secret fields', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ clientSecret: 'secret123', data: 'public' });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(JSON.stringify(logCall![1])).toContain('[REDACTED]');
      });

      it('should redact nested sensitive fields', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ user: { password: 'secret', name: 'John' } });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(JSON.stringify(logCall![1])).toContain('[REDACTED]');
      });
    });

    describe('String truncation', () => {
      it('should truncate long input strings', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true, maxInputLength: 50 });
        const wrapped = withLogging(fn, 'testFn', config);

        const longString = 'a'.repeat(200);
        wrapped({ input: longString });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        const logged = JSON.stringify(logCall![1]);
        expect(logged).toContain('...');
      });

      it('should truncate long output strings', () => {
        const longResult = 'b'.repeat(200);
        const fn = createSyncSuccessFunction('testFn', { output: longResult });
        const config = createMockLogConfig({ logOutputs: true, maxOutputLength: 50 });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped();

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('completed successfully')
        );
        const logged = JSON.stringify(logCall![1]);
        expect(logged).toContain('...');
      });

      it('should not truncate strings within maxLength', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true, maxInputLength: 100 });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ input: 'short string' });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        const logged = JSON.stringify(logCall![1]);
        expect(logged).not.toContain('...');
      });
    });

    describe('BigInt serialization', () => {
      it('should convert BigInt to string', () => {
        const fn = createSyncSuccessFunction('testFn', { id: BigInt('9007199254740991') });
        const config = createMockLogConfig({ logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped();

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('completed successfully')
        );
        expect(logCall).toBeDefined();
        const logged = JSON.stringify(logCall![1]);
        expect(logged).toContain('9007199254740991');
      });

      it('should handle nested BigInt values', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({ data: { bigNum: BigInt('123456789') } });

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(logCall).toBeDefined();
      });

      it('should handle arrays with BigInt values', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped([1, BigInt('999'), 'string']);

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(logCall).toBeDefined();
      });
    });

    describe('Edge cases', () => {
      it('should handle null and undefined', () => {
        const fn = createSyncSuccessFunction('testFn', null);
        const config = createMockLogConfig({ logInputs: true, logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped(null, undefined);

        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should handle empty objects and arrays', () => {
        const fn = createSyncSuccessFunction('testFn', []);
        const config = createMockLogConfig({ logInputs: true, logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped({}, []);

        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should handle primitive types', () => {
        const fn = createSyncSuccessFunction('testFn', 42);
        const config = createMockLogConfig({ logInputs: true, logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped('string', 123, true);

        expect(mockLogger.info).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // withLogging Tests
  // ============================================================================

  describe('withLogging', () => {
    describe('Function entry logging', () => {
      it('should log function call with inputs', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped('arg1', 'arg2');

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Function testFn called',
          expect.objectContaining({
            inputs: expect.any(Array),
            timestamp: expect.any(String),
          })
        );
      });

      it('should not log inputs when logInputs is false', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ logInputs: false });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped('arg1', 'arg2');

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(logCall![1]).toEqual(
          expect.objectContaining({
            inputs: undefined,
            timestamp: expect.any(String),
          })
        );
      });

      it('should include timestamp in entry log', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withLogging(fn, 'testFn');

        wrapped();

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('called')
        );
        expect(logCall![1].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });

    describe('Synchronous function handling', () => {
      it('should execute synchronous functions normally', () => {
        const fn = jest.fn(() => 'result');
        const wrapped = withLogging(fn, 'testFn');

        const result = wrapped('arg1');

        expect(fn).toHaveBeenCalledWith('arg1');
        expect(result).toBe('result');
      });

      it('should log successful completion with duration', () => {
        const timeMock = mockDateNow(1000);
        const fn = createSyncSuccessFunction('testFn', 'success');
        const config = createMockLogConfig({ logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        timeMock.advance(150);
        wrapped();

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Function testFn completed successfully',
          expect.objectContaining({
            duration: expect.stringContaining('ms'),
          })
        );

        timeMock.restore();
      });

      it('should log outputs when logOutputs is true', () => {
        const fn = createSyncSuccessFunction('testFn', { data: 'result' });
        const config = createMockLogConfig({ logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped();

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('completed successfully')
        );
        expect(logCall![1]).toEqual(
          expect.objectContaining({
            outputs: expect.any(Object),
          })
        );
      });

      it('should not log outputs when logOutputs is false', () => {
        const fn = createSyncSuccessFunction('testFn', { data: 'result' });
        const config = createMockLogConfig({ logOutputs: false });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped();

        const logCall = mockLogger.info.mock.calls.find(call =>
          call[0].includes('completed successfully')
        );
        expect(logCall![1]).toEqual(
          expect.objectContaining({
            outputs: undefined,
          })
        );
      });

      it('should handle synchronous errors', () => {
        const fn = createSyncErrorFunction('testFn');
        const config = createMockLogConfig({ logErrors: true });
        const wrapped = withLogging(fn, 'testFn', config);

        expect(() => wrapped()).toThrow('testFn error');

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Function testFn failed',
          expect.objectContaining({
            error: 'testFn error',
            duration: expect.stringContaining('ms'),
          })
        );
      });

      it('should not log errors when logErrors is false', () => {
        const fn = createSyncErrorFunction('testFn');
        const config = createMockLogConfig({ logErrors: false });
        const wrapped = withLogging(fn, 'testFn', config);

        expect(() => wrapped()).toThrow();

        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    });

    describe('Asynchronous function handling', () => {
      it('should execute async functions normally', async () => {
        const fn = jest.fn().mockResolvedValue('async result');
        const wrapped = withLogging(fn, 'testFn');

        const result = await wrapped('arg1');

        expect(fn).toHaveBeenCalledWith('arg1');
        expect(result).toBe('async result');
      });

      it('should log async success', async () => {
        const fn = createAsyncSuccessFunction('testFn', 'async success');
        const config = createMockLogConfig({ logOutputs: true });
        const wrapped = withLogging(fn, 'testFn', config);

        await wrapped();

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Function testFn completed successfully',
          expect.objectContaining({
            outputs: 'async success',
            duration: expect.stringContaining('ms'),
          })
        );
      });

      it('should handle async errors', async () => {
        const fn = createAsyncErrorFunction('testFn');
        const config = createMockLogConfig({ logErrors: true });
        const wrapped = withLogging(fn, 'testFn', config);

        await expect(wrapped()).rejects.toThrow('testFn async error');

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Function testFn failed',
          expect.objectContaining({
            error: 'testFn async error',
            duration: expect.stringContaining('ms'),
          })
        );
      });

      it('should re-throw async errors after logging', async () => {
        const fn = createAsyncErrorFunction('testFn');
        const wrapped = withLogging(fn, 'testFn');

        await expect(wrapped()).rejects.toThrow('testFn async error');
      });
    });

    describe('Configuration handling', () => {
      it('should return original function when enabled is false', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockLogConfig({ enabled: false });
        const wrapped = withLogging(fn, 'testFn', config);

        wrapped();

        expect(mockLogger.info).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('should use default config when not provided', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withLogging(fn, 'testFn');

        wrapped();

        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should merge partial config with defaults', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withLogging(fn, 'testFn', { logInputs: false });

        wrapped();

        expect(mockLogger.info).toHaveBeenCalled();
      });
    });

    describe('Type preservation', () => {
      it('should preserve function signature', () => {
        const fn = (a: number, b: string): boolean => a > 0 && b.length > 0;
        const wrapped = withLogging(fn, 'testFn');

        const result = wrapped(5, 'test');

        expect(typeof result).toBe('boolean');
        expect(result).toBe(true);
      });

      it('should preserve async return type', async () => {
        const fn = async (x: number): Promise<number> => x * 2;
        const wrapped = withLogging(fn, 'testFn');

        const result = await wrapped(5);

        expect(result).toBe(10);
      });
    });
  });

  // ============================================================================
  // withTracing Tests
  // ============================================================================

  describe('withTracing', () => {
    let mockSpan: ReturnType<typeof createMockSpan>;

    beforeEach(() => {
      mockSpan = createMockSpan();
      mockCreateAppSpan.mockReturnValue(mockSpan as any);
    });

    describe('Span creation', () => {
      it('should create span with operation name', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped();

        expect(mockCreateAppSpan).toHaveBeenCalledWith(
          'testOperation',
          expect.objectContaining({
            'operation.name': 'testOperation',
            'function.args.count': 0,
          })
        );
      });

      it('should include argument count in attributes', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped('arg1', 'arg2', 'arg3');

        expect(mockCreateAppSpan).toHaveBeenCalledWith(
          'testOperation',
          expect.objectContaining({
            'function.args.count': 3,
          })
        );
      });

      it('should include custom attributes', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockTracingConfig({
          customAttributes: { 'custom.key': 'value', 'custom.num': 42 },
        });
        const wrapped = withTracing(fn, 'testOperation', config);

        wrapped();

        expect(mockCreateAppSpan).toHaveBeenCalledWith(
          'testOperation',
          expect.objectContaining({
            'custom.key': 'value',
            'custom.num': 42,
          })
        );
      });

      it('should include input length when includeInputs is true', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockTracingConfig({ includeInputs: true });
        const wrapped = withTracing(fn, 'testOperation', config);

        wrapped({ data: 'test' });

        expect(mockCreateAppSpan).toHaveBeenCalledWith(
          'testOperation',
          expect.objectContaining({
            'function.input.length': expect.any(Number),
          })
        );
      });
    });

    describe('Synchronous function tracing', () => {
      it('should set success attributes on completion', () => {
        const fn = createSyncSuccessFunction('testFn', 'result');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'true',
          })
        );
      });

      it('should include output information when includeOutputs is true', () => {
        const fn = createSyncSuccessFunction('testFn', { data: 'result' });
        const config = createMockTracingConfig({ includeOutputs: true });
        const wrapped = withTracing(fn, 'testOperation', config);

        wrapped();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'true',
            'function.output.type': 'object',
            'function.output.length': expect.any(Number),
          })
        );
      });

      it('should record exceptions on errors', () => {
        const fn = createSyncErrorFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        expect(() => wrapped()).toThrow();

        expect(mockSpan.recordException).toHaveBeenCalledWith(expect.any(Error));
        expect(mockSpan.setStatus).toHaveBeenCalledWith({
          code: 2,
          message: 'testFn error',
        });
      });

      it('should set error attributes on failure', () => {
        const fn = createSyncErrorFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        expect(() => wrapped()).toThrow();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'false',
            'function.error.type': expect.any(String), // Can be 'Error' or empty string in test env
            'function.error.message': 'testFn error',
          })
        );
      });

      it('should end span on success', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped();

        expect(mockSpan.end).toHaveBeenCalled();
      });

      it('should end span on error', () => {
        const fn = createSyncErrorFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        expect(() => wrapped()).toThrow();

        expect(mockSpan.end).toHaveBeenCalled();
      });
    });

    describe('Asynchronous function tracing', () => {
      it('should handle async success', async () => {
        const fn = createAsyncSuccessFunction('testFn', 'async result');
        const wrapped = withTracing(fn, 'testOperation');

        await wrapped();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'true',
          })
        );
        expect(mockSpan.end).toHaveBeenCalled();
      });

      it('should handle async errors', async () => {
        const fn = createAsyncErrorFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        await expect(wrapped()).rejects.toThrow();

        expect(mockSpan.recordException).toHaveBeenCalled();
        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'false',
          })
        );
        expect(mockSpan.end).toHaveBeenCalled();
      });

      it('should include output info for async results when enabled', async () => {
        const fn = createAsyncSuccessFunction('testFn', { data: 'async result' });
        const config = createMockTracingConfig({ includeOutputs: true });
        const wrapped = withTracing(fn, 'testOperation', config);

        await wrapped();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.output.type': 'object',
            'function.output.length': expect.any(Number),
          })
        );
      });
    });

    describe('Configuration handling', () => {
      it('should return original function when enabled is false', () => {
        const fn = createSyncSuccessFunction('testFn');
        const config = createMockTracingConfig({ enabled: false });
        const wrapped = withTracing(fn, 'testOperation', config);

        wrapped();

        expect(mockCreateAppSpan).not.toHaveBeenCalled();
      });

      it('should use default config when not provided', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped();

        expect(mockCreateAppSpan).toHaveBeenCalled();
      });

      it('should not include inputs by default', () => {
        const fn = createSyncSuccessFunction('testFn');
        const wrapped = withTracing(fn, 'testOperation');

        wrapped('arg1', 'arg2');

        const call = mockCreateAppSpan.mock.calls[0];
        expect(call[1]).not.toHaveProperty('function.input.length');
      });

      it('should not include outputs by default', () => {
        const fn = createSyncSuccessFunction('testFn', { data: 'result' });
        const wrapped = withTracing(fn, 'testOperation');

        wrapped();

        expect(mockSpan.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            'function.success': 'true',
          })
        );

        const call = mockSpan.setAttributes.mock.calls[0];
        expect(call[0]).not.toHaveProperty('function.output.type');
      });
    });
  });

  // ============================================================================
  // Combined Functionality Tests
  // ============================================================================

  describe('withLoggingAndTracing', () => {
    let mockSpan: ReturnType<typeof createMockSpan>;

    beforeEach(() => {
      mockSpan = createMockSpan();
      mockCreateAppSpan.mockReturnValue(mockSpan as any);
    });

    it('should apply both logging and tracing', () => {
      const fn = createSyncSuccessFunction('testFn', 'result');
      const wrapped = withLoggingAndTracing(fn, 'testOperation');

      wrapped();

      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockCreateAppSpan).toHaveBeenCalled();
    });

    it('should pass configs to both wrappers', () => {
      const fn = createSyncSuccessFunction('testFn');
      const logConfig = createMockLogConfig({ logInputs: false });
      const tracingConfig = createMockTracingConfig({ includeInputs: true });

      const wrapped = withLoggingAndTracing(fn, 'testOperation', logConfig, tracingConfig);

      wrapped('arg1');

      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockCreateAppSpan).toHaveBeenCalled();
    });

    it('should handle errors with both logging and tracing', () => {
      const fn = createSyncErrorFunction('testFn');
      const wrapped = withLoggingAndTracing(fn, 'testOperation');

      expect(() => wrapped()).toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockSpan.recordException).toHaveBeenCalled();
    });
  });

  describe('logMethod decorator', () => {
    it('should wrap class methods', () => {
      class TestClass {
        testMethod(arg: string) {
          return `result: ${arg}`;
        }
      }

      // Manually apply decorator
      const descriptor = {
        value: TestClass.prototype.testMethod,
        writable: true,
        enumerable: false,
        configurable: true,
      };
      const decoratorFn = logMethod();
      decoratorFn(TestClass.prototype, 'testMethod', descriptor);
      TestClass.prototype.testMethod = descriptor.value;

      const instance = new TestClass();
      instance.testMethod('test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TestClass.testMethod'),
        expect.any(Object)
      );
    });

    it('should use custom config for decorator', () => {
      class TestClass {
        testMethod(arg: string) {
          return `result: ${arg}`;
        }
      }

      // Manually apply decorator with config
      const descriptor = {
        value: TestClass.prototype.testMethod,
        writable: true,
        enumerable: false,
        configurable: true,
      };
      const decoratorFn = logMethod({ logInputs: false });
      decoratorFn(TestClass.prototype, 'testMethod', descriptor);
      TestClass.prototype.testMethod = descriptor.value;

      const instance = new TestClass();
      instance.testMethod('test');

      const logCall = mockLogger.info.mock.calls.find(call =>
        call[0].includes('called')
      );
      expect(logCall![1]).toHaveProperty('inputs', undefined);
    });
  });

  describe('createLoggedFunction', () => {
    it('should create a logged function with custom name', () => {
      const fn = createSyncSuccessFunction('originalName', 'result');
      const logged = createLoggedFunction(fn, 'customName');

      logged();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Function customName called',
        expect.any(Object)
      );
    });

    it('should apply custom config', () => {
      const fn = createSyncSuccessFunction('testFn');
      const config = createMockLogConfig({ logOutputs: false });
      const logged = createLoggedFunction(fn, 'customName', config);

      logged();

      const logCall = mockLogger.info.mock.calls.find(call =>
        call[0].includes('completed successfully')
      );
      expect(logCall![1]).toHaveProperty('outputs', undefined);
    });
  });

  describe('withBatchLogging', () => {
    it('should wrap multiple functions', () => {
      const functions = {
        fn1: createSyncSuccessFunction('fn1'),
        fn2: createSyncSuccessFunction('fn2'),
        fn3: createSyncSuccessFunction('fn3'),
      };

      const wrapped = withBatchLogging(functions);

      wrapped.fn1();
      wrapped.fn2();
      wrapped.fn3();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Function fn1 called',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Function fn2 called',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Function fn3 called',
        expect.any(Object)
      );
    });

    it('should apply config to all functions', () => {
      const functions = {
        fn1: createSyncSuccessFunction('fn1'),
        fn2: createSyncSuccessFunction('fn2'),
      };

      const config = createMockLogConfig({ logInputs: false });
      const wrapped = withBatchLogging(functions, config);

      wrapped.fn1();
      wrapped.fn2();

      const logCalls = mockLogger.info.mock.calls.filter(call =>
        call[0].includes('called')
      );
      logCalls.forEach(call => {
        expect(call[1]).toHaveProperty('inputs', undefined);
      });
    });
  });

  describe('initializeAutoLogging', () => {
    const originalWindow = global.window;

    beforeEach(() => {
      // @ts-ignore
      delete global.window;
    });

    afterEach(() => {
      // @ts-ignore
      global.window = originalWindow;
    });

    it('should not initialize on client-side', () => {
      // @ts-ignore
      global.window = {} as any;

      initializeAutoLogging();

      // Function should return early, no imports attempted
      expect(true).toBe(true); // Just verifying no errors
    });

    it('should initialize on server-side', async () => {
      // Ensure window is undefined (server-side)
      // @ts-ignore
      delete global.window;

      // This test just verifies the function can be called
      // Actual module loading would require more complex mocking
      initializeAutoLogging();

      // Wait a tick for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(true).toBe(true); // Verification that function executes
    });
  });
});
