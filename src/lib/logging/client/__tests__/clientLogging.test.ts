import { withClientLogging } from '../clientLogging';
import {
  createMockLogConfig,
  createMockLogger,
  createSensitiveTestData,
  createLargeTestData,
  createBigIntTestData,
  createSyncSuccessFunction,
  createSyncErrorFunction,
  createAsyncSuccessFunction,
  createAsyncErrorFunction,
  mockDateNow,
} from '@/testing/utils/logging-test-helpers';

// Mock the client logger
jest.mock('@/lib/client_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { logger } from '@/lib/client_utilities';

const mockLogger = logger as ReturnType<typeof createMockLogger>;

describe('withClientLogging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('should log function entry and exit for sync functions', () => {
      const fn = createSyncSuccessFunction('testFn', 'result');
      const wrapped = withClientLogging(fn, 'testFn');

      const result = wrapped('arg1', 'arg2');

      expect(result).toBe('result');
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        'Function testFn called',
        expect.objectContaining({ inputs: ['arg1', 'arg2'] })
      );
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        'Function testFn completed successfully',
        expect.objectContaining({ outputs: 'result' })
      );
    });

    it('should log function entry and exit for async functions', async () => {
      const fn = createAsyncSuccessFunction('asyncFn', 'async result');
      const wrapped = withClientLogging(fn, 'asyncFn');

      const result = await wrapped('arg1');

      expect(result).toBe('async result');
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        'Function asyncFn called',
        expect.objectContaining({ inputs: ['arg1'] })
      );
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        'Function asyncFn completed successfully',
        expect.objectContaining({ outputs: 'async result' })
      );
    });

    it('should return original function when disabled', () => {
      const fn = createSyncSuccessFunction('testFn');
      const wrapped = withClientLogging(fn, 'testFn', { enabled: false });

      wrapped();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should log errors for sync functions', () => {
      const fn = createSyncErrorFunction('errorFn');
      const wrapped = withClientLogging(fn, 'errorFn');

      expect(() => wrapped()).toThrow('errorFn error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Function errorFn failed',
        expect.objectContaining({ error: 'errorFn error' })
      );
    });

    it('should log errors for async functions', async () => {
      const fn = createAsyncErrorFunction('asyncErrorFn');
      const wrapped = withClientLogging(fn, 'asyncErrorFn');

      await expect(wrapped()).rejects.toThrow('asyncErrorFn async error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Function asyncErrorFn failed',
        expect.objectContaining({ error: 'asyncErrorFn async error' })
      );
    });

    it('should not log errors when logErrors is false', () => {
      const fn = createSyncErrorFunction('errorFn');
      const wrapped = withClientLogging(fn, 'errorFn', { logErrors: false });

      expect(() => wrapped()).toThrow('errorFn error');
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('data sanitization', () => {
    it('should redact sensitive fields', () => {
      const fn = (data: object) => data;
      const wrapped = withClientLogging(fn, 'sensitiveTest');
      const sensitiveData = createSensitiveTestData();

      wrapped(sensitiveData);

      const logCall = mockLogger.info.mock.calls[0][1];
      expect(logCall.inputs[0].password).toBe('[REDACTED]');
      expect(logCall.inputs[0].apiKey).toBe('[REDACTED]');
      expect(logCall.inputs[0].token).toBe('[REDACTED]');
      expect(logCall.inputs[0].secret).toBe('[REDACTED]');
      expect(logCall.inputs[0].nested.password).toBe('[REDACTED]');
    });

    it('should truncate large strings', () => {
      const fn = (data: string) => data;
      const wrapped = withClientLogging(fn, 'largeDataTest');
      // Create a string longer than SANITIZE_LIMITS.maxStringLength (500)
      const longString = 'a'.repeat(1000);

      wrapped(longString);

      const logCall = mockLogger.info.mock.calls[0][1];
      // String should be truncated at sanitize limit (500 chars) + '...'
      expect(logCall.inputs[0].length).toBe(503);
      expect(logCall.inputs[0].endsWith('...')).toBe(true);
    });

    it('should handle BigInt values', () => {
      const fn = (data: object) => data;
      const wrapped = withClientLogging(fn, 'bigIntTest');
      const bigIntData = createBigIntTestData();

      wrapped(bigIntData);

      const logCall = mockLogger.info.mock.calls[0][1];
      expect(logCall.inputs[0].bigIntValue).toBe('9007199254740991');
      expect(logCall.inputs[0].nested.anotherBigInt).toBe('123456789012345678901234567890');
    });

    it('should handle circular references', () => {
      const fn = (data: object) => data;
      const wrapped = withClientLogging(fn, 'circularTest');
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;

      wrapped(obj);

      const logCall = mockLogger.info.mock.calls[0][1];
      expect(logCall.inputs[0].self).toBe('[Circular Reference]');
    });

    it('should truncate large arrays', () => {
      const fn = (data: unknown[]) => data;
      const wrapped = withClientLogging(fn, 'arrayTest');
      const largeArray = Array.from({ length: 50 }, (_, i) => i);

      wrapped(largeArray);

      const logCall = mockLogger.info.mock.calls[0][1];
      // Array should be truncated to 10 items + message
      expect(logCall.inputs[0].length).toBe(11);
      expect(logCall.inputs[0][10]).toContain('40 more items');
    });
  });

  describe('config options', () => {
    it('should not log inputs when logInputs is false', () => {
      const fn = createSyncSuccessFunction('noInputFn');
      const wrapped = withClientLogging(fn, 'noInputFn', { logInputs: false });

      wrapped('arg1');

      const logCall = mockLogger.info.mock.calls[0][1];
      expect(logCall.inputs).toBeUndefined();
    });

    it('should not log outputs when logOutputs is false', () => {
      const fn = createSyncSuccessFunction('noOutputFn', 'result');
      const wrapped = withClientLogging(fn, 'noOutputFn', { logOutputs: false });

      wrapped();

      const successLogCall = mockLogger.info.mock.calls[1][1];
      expect(successLogCall.outputs).toBeUndefined();
    });
  });

  describe('duration tracking', () => {
    it('should include duration in completion log', () => {
      const timeMock = mockDateNow(1000);
      const fn = () => {
        timeMock.advance(150);
        return 'done';
      };
      const wrapped = withClientLogging(fn, 'durationTest');

      wrapped();

      const successLogCall = mockLogger.info.mock.calls[1][1];
      expect(successLogCall.duration).toBe('150ms');

      timeMock.restore();
    });

    it('should include duration in error log', () => {
      const timeMock = mockDateNow(1000);
      const fn = () => {
        timeMock.advance(200);
        throw new Error('timed error');
      };
      const wrapped = withClientLogging(fn, 'errorDurationTest');

      expect(() => wrapped()).toThrow('timed error');

      const errorLogCall = mockLogger.error.mock.calls[0][1];
      expect(errorLogCall.duration).toBe('200ms');

      timeMock.restore();
    });
  });
});
