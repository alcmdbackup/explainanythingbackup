/**
 * Integration Test: Vercel Bypass
 *
 * Tests the Vercel deployment protection bypass utility functions.
 * These tests verify the bypass cookie obtainment and file-based sharing mechanism.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  needsBypassCookie,
  saveBypassCookieState,
  loadBypassCookieState,
  cleanupBypassCookieFile,
  getBypassCookieFilePath,
} from '../e2e/setup/vercel-bypass';

describe('Vercel Bypass Integration Tests', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  afterEach(async () => {
    // Restore original env vars
    process.env = { ...originalEnv };
    // Cleanup any test files
    await cleanupBypassCookieFile();
  });

  describe('needsBypassCookie', () => {
    it('returns false for localhost URL', () => {
      process.env.BASE_URL = 'http://localhost:3008';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      expect(needsBypassCookie()).toBe(false);
    });

    it('returns false for 127.0.0.1 URL', () => {
      process.env.BASE_URL = 'http://127.0.0.1:3008';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      expect(needsBypassCookie()).toBe(false);
    });

    it('returns false when secret is missing', () => {
      process.env.BASE_URL = 'https://example.vercel.app';
      delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      // Should log warning but return false
      expect(needsBypassCookie()).toBe(false);
    });

    it('returns true for external URL with secret', () => {
      process.env.BASE_URL = 'https://example.vercel.app';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      expect(needsBypassCookie()).toBe(true);
    });

    it('handles empty BASE_URL string (falls back to localhost)', () => {
      process.env.BASE_URL = '';
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      // Empty string falls back to default localhost
      expect(needsBypassCookie()).toBe(false);
    });

    it('returns false when BASE_URL is not set', () => {
      delete process.env.BASE_URL;
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'secret';
      // Should fall back to localhost
      expect(needsBypassCookie()).toBe(false);
    });
  });

  describe('saveBypassCookieState / loadBypassCookieState', () => {
    it('round-trip serialization works', () => {
      const cookie = {
        name: '_vercel_jwt',
        value: 'test-jwt-value',
        domain: 'example.vercel.app',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None' as const,
        expires: Math.floor(Date.now() / 1000) + 3600,
      };

      saveBypassCookieState(cookie);
      const loaded = loadBypassCookieState();

      expect(loaded).not.toBeNull();
      expect(loaded?.cookie.name).toBe('_vercel_jwt');
      expect(loaded?.cookie.value).toBe('test-jwt-value');
      expect(loaded?.cookie.domain).toBe('example.vercel.app');
      expect(loaded?.timestamp).toBeDefined();
    });

    it('handles __Host- prefixed cookies without domain', () => {
      const cookie = {
        name: '__Host-vercel-bypass',
        value: 'test-value',
        // domain is undefined for __Host- cookies
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None' as const,
        expires: Math.floor(Date.now() / 1000) + 3600,
      };

      saveBypassCookieState(cookie);
      const loaded = loadBypassCookieState();

      expect(loaded).not.toBeNull();
      expect(loaded?.cookie.name).toBe('__Host-vercel-bypass');
      expect(loaded?.cookie.domain).toBeUndefined();
    });

    it('load returns null for missing file', async () => {
      await cleanupBypassCookieFile(); // Ensure file is gone
      const loaded = loadBypassCookieState();
      expect(loaded).toBeNull();
    });

    it('load returns null for invalid JSON', () => {
      const filePath = getBypassCookieFilePath();
      fs.writeFileSync(filePath, 'not valid json', { mode: 0o600 });
      const loaded = loadBypassCookieState();
      expect(loaded).toBeNull();
    });

    it('sets restrictive file permissions (0o600)', () => {
      const cookie = {
        name: '_vercel_jwt',
        value: 'secret-jwt',
        domain: 'example.vercel.app',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None' as const,
        expires: Math.floor(Date.now() / 1000) + 3600,
      };

      saveBypassCookieState(cookie);

      const filePath = getBypassCookieFilePath();
      const stats = fs.statSync(filePath);
      // Check that only owner has read/write (0o600)
      // Note: On Windows, permissions may not be enforced the same way
      if (process.platform !== 'win32') {
        const permissions = stats.mode & 0o777;
        expect(permissions).toBe(0o600);
      }
    });
  });

  describe('cleanupBypassCookieFile', () => {
    it('removes file when it exists', async () => {
      const cookie = {
        name: '_vercel_jwt',
        value: 'test',
        domain: 'example.vercel.app',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None' as const,
        expires: Math.floor(Date.now() / 1000) + 3600,
      };

      saveBypassCookieState(cookie);
      const filePath = getBypassCookieFilePath();
      expect(fs.existsSync(filePath)).toBe(true);

      await cleanupBypassCookieFile();
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('no error when file does not exist', async () => {
      await cleanupBypassCookieFile(); // Ensure gone
      await expect(cleanupBypassCookieFile()).resolves.not.toThrow();
    });
  });

  describe('getBypassCookieFilePath', () => {
    it('returns deterministic path in temp directory', () => {
      const path1 = getBypassCookieFilePath();
      const path2 = getBypassCookieFilePath();

      expect(path1).toBe(path2);
      expect(path1).toContain(os.tmpdir());
      expect(path1).toContain('.vercel-bypass-cookie.json');
    });
  });
});
