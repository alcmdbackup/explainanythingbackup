// Unit tests for Sentry sanitization wrapper.
// Tests sensitive field redaction and beforeSendLog filtering behavior.

import type { Log } from '@sentry/core';
import {
  SENTRY_SENSITIVE_FIELDS,
  sanitizeForSentry,
  createBeforeSendLog,
} from './sentrySanitization';
import { defaultLogConfig } from './schemas/schemas';

describe('sentrySanitization', () => {
  describe('SENTRY_SENSITIVE_FIELDS', () => {
    it('should include all default sensitive fields', () => {
      for (const field of defaultLogConfig.sensitiveFields) {
        expect(SENTRY_SENSITIVE_FIELDS).toContain(field);
      }
    });

    it('should include extended Sentry-specific fields', () => {
      const extendedFields = [
        'email',
        'authorization',
        'cookie',
        'session',
        'jwt',
        'bearer',
        'refresh_token',
        'access_token',
      ];

      for (const field of extendedFields) {
        expect(SENTRY_SENSITIVE_FIELDS).toContain(field);
      }
    });
  });

  describe('sanitizeForSentry', () => {
    it('should return undefined for null input', () => {
      expect(sanitizeForSentry(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(sanitizeForSentry(undefined)).toBeUndefined();
    });

    it('should redact default sensitive fields', () => {
      const data = {
        password: 'secret123',
        apiKey: 'key-abc',
        token: 'tok-xyz',
        username: 'testuser',
      };

      const result = sanitizeForSentry(data);

      expect(result).toEqual({
        password: '[REDACTED]',
        apiKey: '[REDACTED]',
        token: '[REDACTED]',
        username: 'testuser',
      });
    });

    it('should redact Sentry-specific sensitive fields', () => {
      const data = {
        email: 'user@example.com',
        authorization: 'Bearer xyz',
        cookie: 'session=abc',
        jwt: 'eyJ...',
        refresh_token: 'refresh-123',
        access_token: 'access-456',
        normalField: 'visible',
      };

      const result = sanitizeForSentry(data);

      expect(result).toEqual({
        email: '[REDACTED]',
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        jwt: '[REDACTED]',
        refresh_token: '[REDACTED]',
        access_token: '[REDACTED]',
        normalField: 'visible',
      });
    });

    it('should handle nested objects', () => {
      const data = {
        user: {
          email: 'nested@example.com',
          name: 'Test User',
        },
        request: {
          headers: {
            authorization: 'Bearer token',
          },
        },
      };

      const result = sanitizeForSentry(data);

      expect(result).toEqual({
        user: {
          email: '[REDACTED]',
          name: 'Test User',
        },
        request: {
          headers: {
            authorization: '[REDACTED]',
          },
        },
      });
    });

    it('should not truncate long strings (unlike default config)', () => {
      const longString = 'a'.repeat(5000);
      const data = { description: longString };

      const result = sanitizeForSentry(data);

      expect(result?.description).toBe(longString);
      expect((result?.description as string).length).toBe(5000);
    });
  });

  describe('createBeforeSendLog', () => {
    const createMockLog = (level: Log['level'], attributes?: Record<string, unknown>): Log => ({
      level,
      message: 'Test message',
      attributes,
    });

    describe('log level filtering', () => {
      it('should filter out trace logs (too verbose)', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('trace');

        expect(beforeSendLog(log)).toBeNull();
      });

      it('should allow debug logs', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('debug');

        expect(beforeSendLog(log)).not.toBeNull();
        expect(beforeSendLog(log)?.level).toBe('debug');
      });

      it('should allow info logs', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('info');

        expect(beforeSendLog(log)).not.toBeNull();
        expect(beforeSendLog(log)?.level).toBe('info');
      });

      it('should allow warn logs', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('warn');

        expect(beforeSendLog(log)).not.toBeNull();
        expect(beforeSendLog(log)?.level).toBe('warn');
      });

      it('should allow error logs', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('error');

        expect(beforeSendLog(log)).not.toBeNull();
        expect(beforeSendLog(log)?.level).toBe('error');
      });

      it('should allow fatal logs', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('fatal');

        expect(beforeSendLog(log)).not.toBeNull();
        expect(beforeSendLog(log)?.level).toBe('fatal');
      });
    });

    describe('attribute sanitization', () => {
      it('should sanitize sensitive attributes', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('error', {
          email: 'user@example.com',
          userId: '123',
          password: 'secret',
        });

        const result = beforeSendLog(log);

        expect(result?.attributes).toEqual({
          email: '[REDACTED]',
          userId: '123',
          password: '[REDACTED]',
        });
      });

      it('should handle logs without attributes', () => {
        const beforeSendLog = createBeforeSendLog();
        const log = createMockLog('error');

        const result = beforeSendLog(log);

        expect(result).not.toBeNull();
        expect(result?.attributes).toBeUndefined();
      });

      it('should set empty object for null attributes after sanitization', () => {
        const beforeSendLog = createBeforeSendLog();
        // Create a log where all attributes would be sanitized to undefined
        const log: Log = {
          level: 'error',
          message: 'Test',
          attributes: {},
        };

        const result = beforeSendLog(log);

        expect(result?.attributes).toEqual({});
      });
    });
  });
});
