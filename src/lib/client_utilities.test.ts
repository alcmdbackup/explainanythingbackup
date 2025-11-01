import { logger } from './client_utilities';
import { RequestIdContext } from './requestIdContext';

jest.mock('./requestIdContext');

describe('client_utilities - logger', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('test-request-123');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('debug', () => {
    it('should not log when debug is false', () => {
      logger.debug('test message', null, false);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log when debug parameter is omitted', () => {
      logger.debug('test message', null);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log with [DEBUG] prefix when debug is true', () => {
      logger.debug('test message', null, true);
      expect(consoleLogSpy).toHaveBeenCalledWith('[DEBUG] test message', {
        requestId: 'test-request-123',
      });
    });

    it('should merge requestId with existing data', () => {
      logger.debug('test message', { key: 'value', count: 42 }, true);
      expect(consoleLogSpy).toHaveBeenCalledWith('[DEBUG] test message', {
        requestId: 'test-request-123',
        key: 'value',
        count: 42,
      });
    });

    it('should call RequestIdContext.getRequestId when debug is true', () => {
      logger.debug('test message', null, true);
      expect(RequestIdContext.getRequestId).toHaveBeenCalled();
    });

    it('should handle null data correctly', () => {
      logger.debug('test message', null, true);
      expect(consoleLogSpy).toHaveBeenCalledWith('[DEBUG] test message', {
        requestId: 'test-request-123',
      });
    });

    it('should work with different requestId values', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('different-id');
      logger.debug('test message', null, true);
      expect(consoleLogSpy).toHaveBeenCalledWith('[DEBUG] test message', {
        requestId: 'different-id',
      });
    });
  });

  describe('error', () => {
    it('should call console.error with [ERROR] prefix', () => {
      logger.error('error message', null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message', {
        requestId: 'test-request-123',
      });
    });

    it('should include requestId in data', () => {
      logger.error('error message', null);
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[1]).toHaveProperty('requestId', 'test-request-123');
    });

    it('should merge requestId with existing data', () => {
      logger.error('error message', { errorCode: 500, details: 'Server Error' });
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message', {
        requestId: 'test-request-123',
        errorCode: 500,
        details: 'Server Error',
      });
    });

    it('should handle null data correctly', () => {
      logger.error('error message', null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message', {
        requestId: 'test-request-123',
      });
    });

    it('should call RequestIdContext.getRequestId', () => {
      logger.error('error message', null);
      expect(RequestIdContext.getRequestId).toHaveBeenCalled();
    });

    it('should work with different requestId values', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('error-req-456');
      logger.error('error message', null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message', {
        requestId: 'error-req-456',
      });
    });

    it('should preserve existing data properties', () => {
      const data = { stack: 'Error stack trace', timestamp: Date.now() };
      logger.error('error message', data);
      const callArgs = consoleErrorSpy.mock.calls[0][1];
      expect(callArgs).toMatchObject(data);
      expect(callArgs.requestId).toBe('test-request-123');
    });
  });

  describe('info', () => {
    it('should call console.log with [INFO] prefix', () => {
      logger.info('info message', null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] info message', {
        requestId: 'test-request-123',
      });
    });

    it('should include requestId in data', () => {
      logger.info('info message', null);
      const callArgs = consoleLogSpy.mock.calls[0];
      expect(callArgs[1]).toHaveProperty('requestId', 'test-request-123');
    });

    it('should merge requestId with existing data', () => {
      logger.info('info message', { userId: 'user-789', action: 'login' });
      expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] info message', {
        requestId: 'test-request-123',
        userId: 'user-789',
        action: 'login',
      });
    });

    it('should handle null data correctly', () => {
      logger.info('info message', null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] info message', {
        requestId: 'test-request-123',
      });
    });

    it('should call RequestIdContext.getRequestId', () => {
      logger.info('info message', null);
      expect(RequestIdContext.getRequestId).toHaveBeenCalled();
    });

    it('should work with different requestId values', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('info-req-999');
      logger.info('info message', null);
      expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] info message', {
        requestId: 'info-req-999',
      });
    });

    it('should handle complex nested data', () => {
      const complexData = {
        user: { id: 123, name: 'Test User' },
        metadata: { timestamp: Date.now() },
      };
      logger.info('info message', complexData);
      const callArgs = consoleLogSpy.mock.calls[0][1];
      expect(callArgs).toMatchObject(complexData);
      expect(callArgs.requestId).toBe('test-request-123');
    });
  });

  describe('warn', () => {
    it('should call console.warn with [WARN] prefix', () => {
      logger.warn('warn message', null);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] warn message', {
        requestId: 'test-request-123',
      });
    });

    it('should include requestId in data', () => {
      logger.warn('warn message', null);
      const callArgs = consoleWarnSpy.mock.calls[0];
      expect(callArgs[1]).toHaveProperty('requestId', 'test-request-123');
    });

    it('should merge requestId with existing data', () => {
      logger.warn('warn message', { warningCode: 'DEPRECATION', feature: 'oldAPI' });
      expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] warn message', {
        requestId: 'test-request-123',
        warningCode: 'DEPRECATION',
        feature: 'oldAPI',
      });
    });

    it('should handle null data correctly', () => {
      logger.warn('warn message', null);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] warn message', {
        requestId: 'test-request-123',
      });
    });

    it('should call RequestIdContext.getRequestId', () => {
      logger.warn('warn message', null);
      expect(RequestIdContext.getRequestId).toHaveBeenCalled();
    });

    it('should work with different requestId values', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('warn-req-777');
      logger.warn('warn message', null);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] warn message', {
        requestId: 'warn-req-777',
      });
    });

    it('should preserve existing data properties', () => {
      const data = { threshold: 100, actual: 95 };
      logger.warn('warn message', data);
      const callArgs = consoleWarnSpy.mock.calls[0][1];
      expect(callArgs).toMatchObject(data);
      expect(callArgs.requestId).toBe('test-request-123');
    });
  });

  describe('requestId handling across all methods', () => {
    it('should inject unknown requestId when getRequestId returns unknown', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('unknown');

      logger.error('test', null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] test', {
        requestId: 'unknown',
      });
    });

    it('should consistently use the same requestId within a single request context', () => {
      (RequestIdContext.getRequestId as jest.Mock).mockReturnValue('consistent-id');

      logger.info('step 1', null);
      logger.warn('step 2', null);
      logger.error('step 3', null);

      expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] step 1', {
        requestId: 'consistent-id',
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] step 2', {
        requestId: 'consistent-id',
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] step 3', {
        requestId: 'consistent-id',
      });
    });
  });

  describe('data spreading behavior', () => {
    it('should place requestId first in the data object', () => {
      logger.info('test', { key: 'value' });
      const callArgs = consoleLogSpy.mock.calls[0][1];
      const keys = Object.keys(callArgs);
      expect(keys[0]).toBe('requestId');
    });

    it('should not mutate the original data object', () => {
      const originalData = { key: 'value' };
      const dataCopy = { ...originalData };
      logger.info('test', originalData);
      expect(originalData).toEqual(dataCopy);
      expect(originalData).not.toHaveProperty('requestId');
    });
  });
});
