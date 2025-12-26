import { appendFileSync } from 'fs';
import { RequestIdContext } from './requestIdContext';
import { logger, getRequiredEnvVar } from './server_utilities';

// Mock dependencies
jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
}));

jest.mock('./requestIdContext', () => ({
  RequestIdContext: {
    getRequestId: jest.fn(() => 'test-request-id'),
    getUserId: jest.fn(() => 'test-user-id'),
    getSessionId: jest.fn(() => 'test-session-id'),
  },
}));

describe('server_utilities', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('logger', () => {
    describe('info', () => {
      it('should log info message without data', () => {
        logger.info('Test info message');

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[INFO] Test info message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id' }
        );
      });

      it('should log info message with data', () => {
        logger.info('Test info message', { key: 'value' });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[INFO] Test info message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id', key: 'value' }
        );
      });

      it('should write to file with proper JSON format', () => {
        logger.info('Test info message', { key: 'value' });

        expect(appendFileSync).toHaveBeenCalledTimes(1);
        const call = (appendFileSync as jest.Mock).mock.calls[0];
        const logEntry = call[1];
        const parsed = JSON.parse(logEntry.trim());

        expect(parsed).toMatchObject({
          level: 'INFO',
          message: 'Test info message',
          data: { key: 'value' },
          requestId: 'test-request-id',
          userId: 'test-user-id',
          sessionId: 'test-session-id',
        });
        expect(parsed.timestamp).toBeDefined();
        expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
      });

      it('should handle null data parameter', () => {
        logger.info('Test message', null);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[INFO] Test message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id' }
        );
      });
    });

    describe('error', () => {
      it('should log error message without data', () => {
        logger.error('Test error message');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[ERROR] Test error message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id' }
        );
      });

      it('should log error message with data', () => {
        logger.error('Test error message', { error: 'details' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[ERROR] Test error message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id', error: 'details' }
        );
      });

      it('should write to file with ERROR level', () => {
        logger.error('Test error', { code: 500 });

        const call = (appendFileSync as jest.Mock).mock.calls[0];
        const logEntry = call[1];
        const parsed = JSON.parse(logEntry.trim());

        expect(parsed.level).toBe('ERROR');
        expect(parsed.message).toBe('Test error');
        expect(parsed.data).toEqual({ code: 500 });
      });
    });

    describe('warn', () => {
      it('should log warning message without data', () => {
        logger.warn('Test warning message');

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[WARN] Test warning message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id' }
        );
      });

      it('should log warning message with data', () => {
        logger.warn('Test warning', { warning: 'deprecated' });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[WARN] Test warning',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id', warning: 'deprecated' }
        );
      });

      it('should write to file with WARN level', () => {
        logger.warn('Test warning');

        const call = (appendFileSync as jest.Mock).mock.calls[0];
        const logEntry = call[1];
        const parsed = JSON.parse(logEntry.trim());

        expect(parsed.level).toBe('WARN');
      });
    });

    describe('debug', () => {
      it('should not log when debug flag is false', () => {
        logger.debug('Test debug message', null, false);

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(appendFileSync).not.toHaveBeenCalled();
      });

      it('should not log when debug flag is not provided (defaults to false)', () => {
        logger.debug('Test debug message');

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(appendFileSync).not.toHaveBeenCalled();
      });

      it('should log when debug flag is true', () => {
        logger.debug('Test debug message', null, true);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[DEBUG] Test debug message',
          { requestId: 'test-request-id', userId: 'test-user-id', sessionId: 'test-session-id' }
        );
      });

      it('should write to file with DEBUG level when debug is true', () => {
        logger.debug('Test debug message', { detail: 'info' }, true);

        const call = (appendFileSync as jest.Mock).mock.calls[0];
        const logEntry = call[1];
        const parsed = JSON.parse(logEntry.trim());

        expect(parsed.level).toBe('DEBUG');
        expect(parsed.message).toBe('Test debug message');
        expect(parsed.data).toEqual({ detail: 'info' });
      });
    });

    describe('request ID injection', () => {
      it('should include request ID and user ID from context', () => {
        logger.info('Test message');

        expect(RequestIdContext.getRequestId).toHaveBeenCalled();
        expect(RequestIdContext.getUserId).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[INFO] Test message',
          expect.objectContaining({
            requestId: 'test-request-id',
            userId: 'test-user-id',
            sessionId: 'test-session-id',
          })
        );
      });

      it('should merge request ID with provided data', () => {
        logger.info('Test message', { custom: 'data' });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[INFO] Test message',
          {
            requestId: 'test-request-id',
            userId: 'test-user-id',
            sessionId: 'test-session-id',
            custom: 'data',
          }
        );
      });
    });

    describe('file write error handling', () => {
      it('should silently fail when file write throws error', () => {
        (appendFileSync as jest.Mock).mockImplementationOnce(() => {
          throw new Error('File write failed');
        });

        // Should not throw
        expect(() => logger.info('Test message')).not.toThrow();

        // Console log should still work
        expect(consoleLogSpy).toHaveBeenCalled();
      });
    });

    describe('complex data serialization', () => {
      it('should handle complex nested objects', () => {
        const complexData = {
          nested: {
            deep: {
              value: 'test',
            },
          },
          array: [1, 2, 3],
          bool: true,
          number: 42,
        };

        logger.info('Complex data', complexData);

        const call = (appendFileSync as jest.Mock).mock.calls[0];
        const logEntry = call[1];
        const parsed = JSON.parse(logEntry.trim());

        expect(parsed.data).toEqual(complexData);
      });
    });
  });

  describe('getRequiredEnvVar', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return environment variable value when set', () => {
      process.env.TEST_VAR = 'test-value';

      const result = getRequiredEnvVar('TEST_VAR');

      expect(result).toBe('test-value');
    });

    it('should throw error when environment variable is not set', () => {
      delete process.env.TEST_VAR;

      expect(() => getRequiredEnvVar('TEST_VAR')).toThrow(
        'Missing required environment variable: TEST_VAR'
      );
    });

    it('should throw error when environment variable is empty string', () => {
      process.env.TEST_VAR = '';

      expect(() => getRequiredEnvVar('TEST_VAR')).toThrow(
        'Missing required environment variable: TEST_VAR'
      );
    });

    it('should handle environment variables with special characters', () => {
      process.env['TEST_VAR_123'] = 'value-with-special-chars!@#';

      const result = getRequiredEnvVar('TEST_VAR_123');

      expect(result).toBe('value-with-special-chars!@#');
    });

    it('should return value with spaces', () => {
      process.env.TEST_VAR = 'value with spaces';

      const result = getRequiredEnvVar('TEST_VAR');

      expect(result).toBe('value with spaces');
    });
  });
});
