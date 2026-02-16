// Unit tests for LLMSemaphore: FIFO counting semaphore for throttling concurrent LLM API calls.

import { LLMSemaphore, getLLMSemaphore, initLLMSemaphore, resetLLMSemaphore } from './llmSemaphore';

describe('LLMSemaphore', () => {
  describe('constructor', () => {
    it('throws when maxConcurrent is less than 1', () => {
      expect(() => new LLMSemaphore(0)).toThrow('maxConcurrent must be >= 1');
      expect(() => new LLMSemaphore(-5)).toThrow('maxConcurrent must be >= 1');
    });

    it('creates semaphore with valid limit', () => {
      const sem = new LLMSemaphore(5);
      expect(sem.limit).toBe(5);
      expect(sem.active).toBe(0);
      expect(sem.waiting).toBe(0);
    });
  });

  describe('acquire/release', () => {
    it('acquires up to the limit without blocking', async () => {
      const sem = new LLMSemaphore(3);

      await sem.acquire();
      await sem.acquire();
      await sem.acquire();

      expect(sem.active).toBe(3);
      expect(sem.waiting).toBe(0);
    });

    it('queues callers beyond the limit', async () => {
      const sem = new LLMSemaphore(2);

      await sem.acquire();
      await sem.acquire();

      // Third acquire should block
      const order: number[] = [];
      const p3 = sem.acquire().then(() => order.push(3));

      expect(sem.waiting).toBe(1);
      expect(sem.active).toBe(2);

      // Release one slot — should unblock p3
      sem.release();
      await p3;

      expect(order).toEqual([3]);
      expect(sem.active).toBe(2);
      expect(sem.waiting).toBe(0);
    });

    it('maintains FIFO ordering for queued waiters', async () => {
      const sem = new LLMSemaphore(1);
      await sem.acquire();

      const order: number[] = [];
      const p1 = sem.acquire().then(() => order.push(1));
      const p2 = sem.acquire().then(() => order.push(2));
      const p3 = sem.acquire().then(() => order.push(3));

      expect(sem.waiting).toBe(3);

      // Release in sequence — should wake in FIFO order
      sem.release();
      await p1;
      sem.release();
      await p2;
      sem.release();
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });

    it('release decrements count when no waiters', () => {
      const sem = new LLMSemaphore(3);

      // Synchronous acquires
      void sem.acquire();
      void sem.acquire();
      expect(sem.active).toBe(2);

      sem.release();
      expect(sem.active).toBe(1);

      sem.release();
      expect(sem.active).toBe(0);
    });

    it('handles rapid acquire/release cycles', async () => {
      const sem = new LLMSemaphore(2);
      const results: number[] = [];

      const tasks = Array.from({ length: 10 }, (_, i) =>
        sem.acquire().then(() => {
          results.push(i);
          sem.release();
        })
      );

      await Promise.all(tasks);

      expect(results.length).toBe(10);
    });
  });

  describe('concurrent simulation', () => {
    it('limits true concurrency to maxConcurrent', async () => {
      const sem = new LLMSemaphore(3);
      let peakConcurrent = 0;
      let currentConcurrent = 0;

      const work = async (id: number) => {
        await sem.acquire();
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
        sem.release();
        return id;
      };

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => work(i))
      );

      expect(results.length).toBe(10);
      expect(peakConcurrent).toBeLessThanOrEqual(3);
    });
  });
});

describe('Singleton management', () => {
  beforeEach(() => {
    resetLLMSemaphore();
    delete process.env.EVOLUTION_MAX_CONCURRENT_LLM;
  });

  afterEach(() => {
    resetLLMSemaphore();
    delete process.env.EVOLUTION_MAX_CONCURRENT_LLM;
  });

  it('getLLMSemaphore returns singleton with default limit 20', () => {
    const sem = getLLMSemaphore();
    expect(sem.limit).toBe(20);
    expect(getLLMSemaphore()).toBe(sem); // same instance
  });

  it('getLLMSemaphore reads EVOLUTION_MAX_CONCURRENT_LLM env var', () => {
    process.env.EVOLUTION_MAX_CONCURRENT_LLM = '10';
    const sem = getLLMSemaphore();
    expect(sem.limit).toBe(10);
  });

  it('initLLMSemaphore replaces singleton', () => {
    const sem1 = getLLMSemaphore();
    expect(sem1.limit).toBe(20);

    const sem2 = initLLMSemaphore(5);
    expect(sem2.limit).toBe(5);
    expect(getLLMSemaphore()).toBe(sem2);
    expect(getLLMSemaphore()).not.toBe(sem1);
  });

  it('resetLLMSemaphore clears singleton', () => {
    const sem1 = getLLMSemaphore();
    resetLLMSemaphore();
    const sem2 = getLLMSemaphore();
    expect(sem2).not.toBe(sem1);
  });
});
