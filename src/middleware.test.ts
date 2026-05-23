/**
 * @jest-environment node
 */

/**
 * Tests for the Next.js middleware. Covers the hostname-based routing gate
 * added in the explainanything/evolution website split plus the existing
 * Supabase session refresh delegation.
 */

// Mock dependencies before imports.
jest.mock('@/lib/utils/supabase/middleware');
jest.mock('next/server');

import { middleware, config } from './middleware';
import { updateSession } from '@/lib/utils/supabase/middleware';
import { NextResponse } from 'next/server';
import {
  NextRequest as MockNextRequest,
  NextResponse as MockNextResponse,
} from '@/__mocks__/next/server';
import { PROD_PUBLIC_HOST, PROD_EVOLUTION_HOST } from '@/config/hostnames';

const mockUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;

/**
 * Build a NextRequest mock that carries a Host header.
 * Mimics what Vercel sends in production — `request.headers.get('host')`
 * returns the actual hostname the client requested.
 */
function reqWithHost(host: string, path: string): import('next/server').NextRequest {
  const url = new URL(path, `http://${host}`);
  const req = new MockNextRequest(url.toString(), { headers: { host } });
  return req as unknown as import('next/server').NextRequest;
}

describe('middleware', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VERCEL_ENV;
    // Default: updateSession returns a 200 NextResponse
    mockUpdateSession.mockResolvedValue(
      new MockNextResponse(null, { status: 200 }) as unknown as NextResponse,
    );
  });

  afterAll(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  describe('public host', () => {
    it('blocks /admin/evolution/* with 404', async () => {
      const res = await middleware(reqWithHost(PROD_PUBLIC_HOST, '/admin/evolution/runs'));
      expect(res.status).toBe(404);
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });

    it('blocks /api/evolution/* with 404', async () => {
      const res = await middleware(reqWithHost(PROD_PUBLIC_HOST, '/api/evolution/run'));
      expect(res.status).toBe(404);
    });

    it('passes / through updateSession', async () => {
      await middleware(reqWithHost(PROD_PUBLIC_HOST, '/'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('passes /results through updateSession', async () => {
      await middleware(reqWithHost(PROD_PUBLIC_HOST, '/results?q=foo'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('passes /admin/content through (non-evolution admin) without blocking', async () => {
      await middleware(reqWithHost(PROD_PUBLIC_HOST, '/admin/content'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('evolution host', () => {
    it('blocks /results with 404', async () => {
      const res = await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/results'));
      expect(res.status).toBe(404);
    });

    it('blocks /explanations with 404', async () => {
      const res = await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/explanations'));
      expect(res.status).toBe(404);
    });

    it('blocks /api/returnExplanation with 404', async () => {
      const res = await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/api/returnExplanation'));
      expect(res.status).toBe(404);
    });

    it('redirects / to /admin/evolution-dashboard', async () => {
      const res = await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/'));
      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toContain('/admin/evolution-dashboard');
    });

    it('passes /admin/evolution/* through updateSession', async () => {
      await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/admin/evolution/runs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('passes /api/evolution/run through updateSession', async () => {
      await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/api/evolution/run'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('localhost', () => {
    it('bypasses both gates for /admin/evolution/runs', async () => {
      await middleware(reqWithHost('localhost', '/admin/evolution/runs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('bypasses both gates for /results', async () => {
      await middleware(reqWithHost('localhost', '/results'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('with port works (localhost:3008)', async () => {
      await middleware(reqWithHost('localhost:3008', '/admin/evolution/runs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('127.0.0.1 bypasses', async () => {
      await middleware(reqWithHost('127.0.0.1', '/admin/evolution/runs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('preview deployments', () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = 'preview';
    });

    it('bypasses both gates regardless of host', async () => {
      await middleware(reqWithHost('feat-branch-explainanything-team.vercel.app', '/admin/evolution/runs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown host (fail-closed)', () => {
    it('returns 404 for an arbitrary host', async () => {
      const res = await middleware(reqWithHost('attacker.com', '/'));
      expect(res.status).toBe(404);
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });

    it('returns 404 for suffix-extension attempt', async () => {
      const res = await middleware(reqWithHost(`${PROD_EVOLUTION_HOST}.attacker.com`, '/admin/evolution/runs'));
      expect(res.status).toBe(404);
    });

    it('returns 404 for empty host header', async () => {
      const url = `http://${PROD_PUBLIC_HOST}/results`;
      // No host header set at all → headers.get('host') returns null
      const req = new MockNextRequest(url) as unknown as import('next/server').NextRequest;
      const res = await middleware(req);
      expect(res.status).toBe(404);
    });
  });

  describe('always-allowed paths', () => {
    it('lets /api/health through even from an unknown host', async () => {
      await middleware(reqWithHost('attacker.com', '/api/health'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('lets /api/monitoring through', async () => {
      await middleware(reqWithHost(PROD_PUBLIC_HOST, '/api/monitoring'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('lets /api/traces through', async () => {
      await middleware(reqWithHost(PROD_EVOLUTION_HOST, '/api/traces'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    it('lets /api/client-logs through', async () => {
      await middleware(reqWithHost('attacker.com', '/api/client-logs'));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('config.matcher', () => {
    it('exports a matcher array', () => {
      expect(config.matcher).toBeDefined();
      expect(Array.isArray(config.matcher)).toBe(true);
      expect(config.matcher.length).toBeGreaterThan(0);
    });
  });
});
