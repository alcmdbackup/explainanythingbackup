// Tests for src/config/hostnames.ts — locks in classifyHost's strict-match behavior
// so future devs don't accidentally relax it (e.g. via a regex preview-URL match,
// which was rejected as Fix B during the smoke_test_and_nightly_e2e_failing_20260523
// plan-review because it would re-open a fail-closed-bypass attack surface).

import { classifyHost } from '../hostnames';

describe('classifyHost', () => {
  // Snapshot + restore VERCEL_ENV so the `preview` escape-hatch branch can't
  // bleed across tests (Jest doesn't isolate process.env by default).
  const originalVercelEnv = process.env.VERCEL_ENV;
  afterEach(() => {
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
  });

  describe('production hostnames (exact match)', () => {
    it('classifies the apex public hostname as public', () => {
      expect(classifyHost('explainanything.vercel.app')).toBe('public');
    });

    it('classifies the apex evolution hostname as evolution', () => {
      expect(classifyHost('ea-evolution.vercel.app')).toBe('evolution');
    });

    it('is case-insensitive on production hostnames', () => {
      expect(classifyHost('Explainanything.Vercel.App')).toBe('public');
      expect(classifyHost('EA-EVOLUTION.VERCEL.APP')).toBe('evolution');
    });

    it('strips ports before matching', () => {
      expect(classifyHost('explainanything.vercel.app:443')).toBe('public');
      expect(classifyHost('ea-evolution.vercel.app:80')).toBe('evolution');
    });
  });

  describe('local hostnames', () => {
    it.each([['localhost'], ['127.0.0.1'], ['0.0.0.0']])(
      'classifies %s as local',
      (host) => {
        expect(classifyHost(host)).toBe('local');
      },
    );

    it('strips ports for local hostnames', () => {
      expect(classifyHost('localhost:3000')).toBe('local');
    });
  });

  describe('unknown hostnames — fail-closed regression guards', () => {
    // CRITICAL: these tests pin the strict-exact-match contract that the
    // smoke_test_and_nightly_e2e_failing_20260523 plan-review iter-1 settled.
    // Relaxing classifyHost to suffix- or regex-match preview URLs would
    // re-open the attack surface that `PROD_PUBLIC_HOST` was deliberately
    // declared as an exact-equality constant to prevent (see hostnames.ts:8-9).
    //
    // The post-deploy smoke matrix already pins its public-row BASE_URL to the
    // apex; preview-URL classification is supposed to fall through to 'unknown'.

    it('classifies a Vercel per-deployment preview URL as unknown', () => {
      expect(
        classifyHost('explainanything-3ad03ivv0-acs-projects-dcdb9943.vercel.app'),
      ).toBe('unknown');
    });

    it('classifies an evolution-style preview URL as unknown', () => {
      expect(
        classifyHost('ea-evolution-abc123-acs-projects-dcdb9943.vercel.app'),
      ).toBe('unknown');
    });

    it('classifies an arbitrary external hostname as unknown', () => {
      expect(classifyHost('evil.com')).toBe('unknown');
    });

    it('classifies a hostname that suffix-matches the apex as unknown', () => {
      // Suffix-extension attack surface: prefix.explainanything.vercel.app
      // must NOT match. The `===` check in classifyHost guards this.
      expect(classifyHost('attacker.explainanything.vercel.app')).toBe('unknown');
    });

    it('classifies an empty string as unknown', () => {
      expect(classifyHost('')).toBe('unknown');
    });

    it('classifies null as unknown', () => {
      expect(classifyHost(null)).toBe('unknown');
    });

    it('classifies undefined as unknown', () => {
      expect(classifyHost(undefined)).toBe('unknown');
    });
  });

  describe('VERCEL_ENV=preview escape hatch', () => {
    it('returns preview for any non-local host when VERCEL_ENV=preview', () => {
      process.env.VERCEL_ENV = 'preview';
      expect(classifyHost('explainanything-abc123.vercel.app')).toBe('preview');
      expect(classifyHost('evil.com')).toBe('preview');
    });

    it('keeps local hosts as local even when VERCEL_ENV=preview', () => {
      // local check runs before the preview branch in classifyHost
      process.env.VERCEL_ENV = 'preview';
      expect(classifyHost('localhost')).toBe('local');
    });

    it('does NOT trigger preview branch when VERCEL_ENV=production', () => {
      // This is the post-deploy-smoke production-build case that motivated
      // pinning the smoke matrix to the apex URL.
      process.env.VERCEL_ENV = 'production';
      expect(
        classifyHost('explainanything-3ad03ivv0-acs-projects-dcdb9943.vercel.app'),
      ).toBe('unknown');
    });
  });
});
