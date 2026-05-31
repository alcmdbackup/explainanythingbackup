// Unit tests for safeGoto — hand-rolled Page mock; does NOT import the real
// @playwright/test Page (incompatible with jsdom).

import { safeGoto } from './safe-goto';

type MockPage = {
  goto: jest.Mock;
  waitForLoadState: jest.Mock;
};

function makePage(): MockPage {
  return {
    goto: jest.fn(),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
  };
}

describe('safeGoto', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('success path forwards args and return value; no retry', async () => {
    const page = makePage();
    const fakeResponse = { ok: () => true } as unknown;
    page.goto.mockResolvedValueOnce(fakeResponse);

const result = await safeGoto(page as any, '/foo', { timeout: 1000 });

    expect(result).toBe(fakeResponse);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('/foo', { timeout: 1000 });
    expect(page.waitForLoadState).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('NS_BINDING_ABORTED on first call: catches, waits, retries once, succeeds', async () => {
    const page = makePage();
    page.goto
      .mockRejectedValueOnce(new Error('page.goto: NS_BINDING_ABORTED; maybe frame was detached?'))
      .mockResolvedValueOnce(null);

const result = await safeGoto(page as any, '/bar');

    expect(result).toBeNull();
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/NS_BINDING_ABORTED retry on \/bar/);
  });

  test('non-NS error: thrown unchanged, no retry, no warn', async () => {
    const page = makePage();
    const realErr = new Error('Timeout 30000ms exceeded');
    page.goto.mockRejectedValueOnce(realErr);

await expect(safeGoto(page as any, '/baz')).rejects.toBe(realErr);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForLoadState).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('NS_BINDING_ABORTED on both attempts: re-throws the second error', async () => {
    const page = makePage();
    const second = new Error('page.goto: NS_BINDING_ABORTED (second)');
    page.goto
      .mockRejectedValueOnce(new Error('page.goto: NS_BINDING_ABORTED (first)'))
      .mockRejectedValueOnce(second);

await expect(safeGoto(page as any, '/qux')).rejects.toBe(second);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('options forwarded to both attempts', async () => {
    const page = makePage();
    page.goto
      .mockRejectedValueOnce(new Error('page.goto: NS_BINDING_ABORTED'))
      .mockResolvedValueOnce(null);

    const opts = { timeout: 7777, waitUntil: 'load' as const };
await safeGoto(page as any, '/opts', opts);

    expect(page.goto).toHaveBeenNthCalledWith(1, '/opts', opts);
    expect(page.goto).toHaveBeenNthCalledWith(2, '/opts', opts);
  });

  test('waitForLoadState rejection is swallowed; retry still attempted', async () => {
    const page = makePage();
    page.waitForLoadState.mockRejectedValueOnce(new Error('settle failed'));
    page.goto
      .mockRejectedValueOnce(new Error('NS_BINDING_ABORTED'))
      .mockResolvedValueOnce(null);

const result = await safeGoto(page as any, '/swallow');

    expect(result).toBeNull();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
});
