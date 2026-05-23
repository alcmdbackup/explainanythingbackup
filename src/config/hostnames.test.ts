/**
 * Unit tests for src/config/hostnames.ts — host classification used by
 * middleware, requireAdmin(), and Sentry tagging for the explainanything /
 * evolution website split.
 */

import {
  classifyHost,
  PROD_PUBLIC_HOST,
  PROD_EVOLUTION_HOST,
} from './hostnames';

describe('classifyHost', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  it('returns "local" for localhost (exact)', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost('localhost')).toBe('local');
    expect(classifyHost('localhost:3008')).toBe('local');
    expect(classifyHost('127.0.0.1')).toBe('local');
    expect(classifyHost('127.0.0.1:8000')).toBe('local');
    expect(classifyHost('0.0.0.0')).toBe('local');
  });

  it('returns "preview" when VERCEL_ENV=preview, regardless of host', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(classifyHost('feat-branch-explainanything-team.vercel.app')).toBe('preview');
    expect(classifyHost('whatever.example.com')).toBe('preview');
  });

  it('local check beats preview check', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(classifyHost('localhost')).toBe('local');
  });

  it('returns "public" for exact production public host', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost(PROD_PUBLIC_HOST)).toBe('public');
    expect(classifyHost(PROD_PUBLIC_HOST.toUpperCase())).toBe('public');
    expect(classifyHost(`${PROD_PUBLIC_HOST}:443`)).toBe('public');
  });

  it('returns "evolution" for exact production evolution host', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost(PROD_EVOLUTION_HOST)).toBe('evolution');
    expect(classifyHost(PROD_EVOLUTION_HOST.toUpperCase())).toBe('evolution');
    expect(classifyHost(`${PROD_EVOLUTION_HOST}:443`)).toBe('evolution');
  });

  it('defends against suffix-extension attacks (host.attacker.com)', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost(`${PROD_PUBLIC_HOST}.attacker.com`)).toBe('unknown');
    expect(classifyHost(`${PROD_EVOLUTION_HOST}.attacker.com`)).toBe('unknown');
    expect(classifyHost('localhostattacker.com')).toBe('unknown');
    expect(classifyHost('localhost.attacker.com')).toBe('unknown');
  });

  it('returns "unknown" for empty / null / undefined', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost(null)).toBe('unknown');
    expect(classifyHost(undefined)).toBe('unknown');
    expect(classifyHost('')).toBe('unknown');
  });

  it('returns "unknown" for an arbitrary unrelated host', () => {
    delete process.env.VERCEL_ENV;
    expect(classifyHost('attacker.com')).toBe('unknown');
    expect(classifyHost('explainanything.com')).toBe('unknown'); // not the configured prod host
  });
});
