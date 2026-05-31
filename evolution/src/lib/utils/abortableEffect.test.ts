// Unit tests for abortableEffectController — the AbortController-wrapping helper
// used by EntityMetricsTab and AttributionCharts for React useEffect cleanup.

import { abortableEffectController } from './abortableEffect';

describe('abortableEffectController', () => {
  test('initial state: not cancelled, signal not aborted', () => {
    const ctl = abortableEffectController();
    expect(ctl.cancelled).toBe(false);
    expect(ctl.signal.aborted).toBe(false);
  });

  test('abort() flips cancelled + signal.aborted', () => {
    const ctl = abortableEffectController();
    ctl.abort();
    expect(ctl.cancelled).toBe(true);
    expect(ctl.signal.aborted).toBe(true);
  });

  test('double-abort is idempotent', () => {
    const ctl = abortableEffectController();
    ctl.abort();
    ctl.abort();
    expect(ctl.cancelled).toBe(true);
    expect(ctl.signal.aborted).toBe(true);
  });

  test('signal is a real AbortSignal', () => {
    const ctl = abortableEffectController();
    expect(ctl.signal).toBeInstanceOf(AbortSignal);
  });

  test('signal.addEventListener fires on abort', () => {
    const ctl = abortableEffectController();
    const onAbort = jest.fn();
    ctl.signal.addEventListener('abort', onAbort);
    ctl.abort();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
