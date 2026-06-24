// Unit test for the Prompt Editor config-id allocator (T16 regression).
import { nextConfigId } from './configId';

describe('nextConfigId (T16)', () => {
  it('returns 1 for an empty list', () => {
    expect(nextConfigId([])).toBe(1);
  });

  it('returns max id + 1 (no skipped numbers)', () => {
    expect(nextConfigId([{ id: 1 }])).toBe(2);
    expect(nextConfigId([{ id: 1 }, { id: 2 }])).toBe(3);
  });

  it('is pure — repeated calls on the same list return the same id (StrictMode-safe)', () => {
    const cs = [{ id: 1 }, { id: 2 }];
    expect(nextConfigId(cs)).toBe(3);
    expect(nextConfigId(cs)).toBe(3); // no mutation / double-increment
  });

  it('handles non-contiguous ids (after removals) by using the max', () => {
    expect(nextConfigId([{ id: 1 }, { id: 5 }])).toBe(6);
  });
});
