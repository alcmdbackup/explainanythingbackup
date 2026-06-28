/**
 * Host-isolation E2E for the public /edit surface (Phase 2 of
 * build_website_for_evolutiOn_20260626).
 *
 * /edit lives in PUBLIC_PREFIXES, so it should serve on the public host
 * and 404 on the evolution host. Mirrors the existing 00-host-isolation
 * spec pattern: spoof the Host header via APIRequestContext.
 *
 * Tags: @critical (runs on every PR to main) + @skip-prod (don't burn
 * real production cycles on a route-level smoke).
 */

import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { PROD_PUBLIC_HOST, PROD_EVOLUTION_HOST } from '@/config/hostnames';

async function ctxWithHost(host: string, baseURL: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { host },
    maxRedirects: 0,
  });
}

test.describe('/edit host isolation', { tag: ['@critical', '@skip-prod'] }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    if (process.env.VERCEL_ENV === 'preview') {
      throw new Error(
        'edit-host-isolation.spec.ts requires VERCEL_ENV to be unset (preview tier bypasses the gate).',
      );
    }
  });

  test.describe('Public host', () => {
    test.describe.configure({ mode: 'serial' });
    let ctx: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
      ctx = await ctxWithHost(PROD_PUBLIC_HOST, baseURL!);
    });
    test.afterAll(async () => {
      await ctx.dispose();
    });

    test('serves /edit (200 or redirect to /login, never 404)', async () => {
      const res = await ctx.get('/edit');
      // /edit is public and unauthed, but middleware might redirect on missing session
      // before guest-autologin lands (race; in tests it should just 200).
      expect(res.status()).not.toBe(404);
    });

    test('serves /edit/runs/<uuid> (200 or 307; never 404)', async () => {
      const res = await ctx.get('/edit/runs/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
      expect(res.status()).not.toBe(404);
    });
  });

  test.describe('Evolution host', () => {
    test.describe.configure({ mode: 'serial' });
    let ctx: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
      ctx = await ctxWithHost(PROD_EVOLUTION_HOST, baseURL!);
    });
    test.afterAll(async () => {
      await ctx.dispose();
    });

    test('blocks /edit with 404', async () => {
      const res = await ctx.get('/edit');
      expect(res.status()).toBe(404);
    });

    test('blocks /edit/runs/<uuid> with 404', async () => {
      const res = await ctx.get('/edit/runs/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
      expect(res.status()).toBe(404);
    });
  });
});
