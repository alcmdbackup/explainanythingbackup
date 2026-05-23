/**
 * Unit tests for the Pinecone explainanything reset script.
 * Exercises the pure runReset() function against an in-memory mock of the
 * Pinecone client; no real Pinecone calls.
 */

import { runReset, type ResetOptions } from './reset-explainanything-pinecone';

interface MockNamespaceState {
  recordCount: number;
}

class MockIndex {
  constructor(private state: Record<string, MockNamespaceState>) {}

  async describeIndexStats() {
    return {
      namespaces: { ...this.state },
      totalRecordCount: Object.values(this.state).reduce((s, n) => s + n.recordCount, 0),
    };
  }

  namespace(name: string) {
    return {
      deleteAll: async () => {
        // Simulate "eventually consistent" by setting to 0 immediately.
        // (Real Pinecone might lag; the test exercises the post-delete pollers separately.)
        if (this.state[name]) this.state[name].recordCount = 0;
      },
    };
  }
}

class MockPinecone {
  private indexes: Record<string, MockIndex> = {};

  setNamespaces(indexName: string, state: Record<string, MockNamespaceState>) {
    this.indexes[indexName] = new MockIndex(state);
  }

  index(name: string) {
    return this.indexes[name] ?? new MockIndex({});
  }
}

describe('runReset (Pinecone)', () => {
  it('dry-run lists namespaces without deleting', async () => {
    const client = new MockPinecone();
    client.setNamespaces('test-index', {
      'default': { recordCount: 100 },
      'evolution': { recordCount: 50 },
    });

    const result = await runReset(client as any, 'test-index', {
      isDryRun: true, isProd: false, skipPromptForTest: true,
    });

    expect(result.isDryRun).toBe(true);
    expect(result.namespaces).toHaveLength(2);
    for (const ns of result.namespaces) {
      expect(ns.deletedSuccessfully).toBe(false);
      expect(ns.notes).toContain('dry-run');
      expect(ns.finalCount).toBe(ns.initialCount);
    }
  });

  it('apply with skipPromptForTest deletes all namespaces', async () => {
    const client = new MockPinecone();
    client.setNamespaces('test-index', {
      'default': { recordCount: 100 },
    });

    const result = await runReset(client as any, 'test-index', {
      isDryRun: false, isProd: true, skipPromptForTest: true,
    });

    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]).toMatchObject({
      name: 'default',
      initialCount: 100,
      deletedSuccessfully: true,
      finalCount: 0,
    });
  });

  it('apply with explicit namespaces list scopes the deletion', async () => {
    const client = new MockPinecone();
    client.setNamespaces('test-index', {
      'a': { recordCount: 10 },
      'b': { recordCount: 20 },
      'c': { recordCount: 30 },
    });

    const result = await runReset(client as any, 'test-index', {
      isDryRun: false, isProd: true, namespaces: ['a', 'c'], skipPromptForTest: true,
    });

    expect(result.namespaces.map((n) => n.name).sort()).toEqual(['a', 'c']);
    // 'b' is untouched
    const stats = await client.index('test-index').describeIndexStats();
    expect(stats.namespaces?.['b']?.recordCount).toBe(20);
  });

  it('is idempotent on already-empty namespaces', async () => {
    const client = new MockPinecone();
    client.setNamespaces('test-index', {
      'default': { recordCount: 0 },
    });

    const result = await runReset(client as any, 'test-index', {
      isDryRun: false, isProd: true, skipPromptForTest: true,
    });

    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]?.deletedSuccessfully).toBe(true);
    expect(result.namespaces[0]?.finalCount).toBe(0);
  });
});
