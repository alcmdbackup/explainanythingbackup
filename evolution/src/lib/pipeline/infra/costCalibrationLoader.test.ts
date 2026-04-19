// Tests for the cost calibration loader: kill switch behavior, row-missing
// fallback, promise coalescing, and cold-start safety.

import {
  isCalibrationEnabled,
  getCalibrationRow,
  hydrateCalibrationCache,
  _resetForTesting,
} from './costCalibrationLoader';

describe('costCalibrationLoader', () => {
  beforeEach(() => {
    _resetForTesting();
    delete process.env.COST_CALIBRATION_ENABLED;
    delete process.env.COST_CALIBRATION_TTL_MS;
  });

  afterAll(() => {
    _resetForTesting();
  });

  describe('kill switch', () => {
    it('defaults to disabled when env var unset', () => {
      expect(isCalibrationEnabled()).toBe(false);
    });

    it("enabled when COST_CALIBRATION_ENABLED='true'", () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      expect(isCalibrationEnabled()).toBe(true);
    });

    it("disabled when COST_CALIBRATION_ENABLED='false'", () => {
      process.env.COST_CALIBRATION_ENABLED = 'false';
      expect(isCalibrationEnabled()).toBe(false);
    });

    it('disabled for any non-"true" value', () => {
      process.env.COST_CALIBRATION_ENABLED = '1';
      expect(isCalibrationEnabled()).toBe(false);
      process.env.COST_CALIBRATION_ENABLED = 'yes';
      expect(isCalibrationEnabled()).toBe(false);
    });

    it('getCalibrationRow returns null when disabled regardless of cache contents', () => {
      process.env.COST_CALIBRATION_ENABLED = 'false';
      const row = getCalibrationRow('structural_transform', 'gpt-4o-mini', 'qwen-2.5-7b', 'generation');
      expect(row).toBeNull();
    });
  });

  describe('hydrateCalibrationCache', () => {
    it('is a no-op when calibration is disabled', async () => {
      const mockDb = { from: jest.fn() } as unknown as import('@supabase/supabase-js').SupabaseClient;
      await hydrateCalibrationCache(mockDb);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('queries the DB exactly once even with N concurrent callers (promise coalescing)', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      let callCount = 0;
      const mockDb = {
        from: jest.fn(() => {
          callCount += 1;
          return {
            select: jest.fn(() => new Promise((resolve) => {
              setTimeout(() => resolve({ data: [], error: null }), 20);
            })),
          };
        }),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await Promise.all([
        hydrateCalibrationCache(mockDb),
        hydrateCalibrationCache(mockDb),
        hydrateCalibrationCache(mockDb),
        hydrateCalibrationCache(mockDb),
      ]);
      expect(callCount).toBe(1);
    });

    it('populates cache from DB rows; getCalibrationRow returns them', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      const rows = [
        {
          strategy: 'structural_transform',
          generation_model: 'gpt-4o-mini',
          judge_model: 'qwen-2.5-7b',
          phase: 'generation',
          avg_output_chars: 9500,
          avg_input_overhead_chars: 500,
          avg_cost_per_call: 0.004,
          n_samples: 42,
          last_refreshed_at: new Date().toISOString(),
        },
      ];
      const mockDb = {
        from: jest.fn(() => ({
          select: jest.fn(() => Promise.resolve({ data: rows, error: null })),
        })),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await hydrateCalibrationCache(mockDb);
      const row = getCalibrationRow('structural_transform', 'gpt-4o-mini', 'qwen-2.5-7b', 'generation');
      expect(row).not.toBeNull();
      expect(row?.avgOutputChars).toBe(9500);
      expect(row?.nSamples).toBe(42);
    });

    it('returns null for a missing slice; caller falls back to hardcoded default', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      const mockDb = {
        from: jest.fn(() => ({
          select: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await hydrateCalibrationCache(mockDb);
      const row = getCalibrationRow('unknown_strategy', 'gpt-4o', 'qwen-2.5-7b', 'generation');
      expect(row).toBeNull();
    });

    it('DB error does not throw; cache stays empty and callers get null fallback', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      const mockDb = {
        from: jest.fn(() => ({
          select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'db down' } })),
        })),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await expect(hydrateCalibrationCache(mockDb)).resolves.toBeUndefined();
      const row = getCalibrationRow('structural_transform', 'gpt-4o-mini', 'qwen-2.5-7b', 'generation');
      expect(row).toBeNull();
    });

    it('widens lookups via sentinel when specific slices are missing', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      const rows = [
        {
          strategy: '__unspecified__',
          generation_model: 'gpt-4o-mini',
          judge_model: '__unspecified__',
          phase: 'generation',
          avg_output_chars: 8000,
          avg_input_overhead_chars: 0,
          avg_cost_per_call: 0.003,
          n_samples: 10,
          last_refreshed_at: new Date().toISOString(),
        },
      ];
      const mockDb = {
        from: jest.fn(() => ({
          select: jest.fn(() => Promise.resolve({ data: rows, error: null })),
        })),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await hydrateCalibrationCache(mockDb);
      // Specific (strategy, genModel, judgeModel) miss → widens to (sentinel, genModel, sentinel)
      const row = getCalibrationRow('brand_new_strategy', 'gpt-4o-mini', 'some-judge', 'generation');
      expect(row?.avgOutputChars).toBe(8000);
    });

    it('respects TTL: re-hydrate within TTL is a no-op; after TTL elapses, refetches', async () => {
      process.env.COST_CALIBRATION_ENABLED = 'true';
      process.env.COST_CALIBRATION_TTL_MS = '50';
      let callCount = 0;
      const mockDb = {
        from: jest.fn(() => {
          callCount += 1;
          return {
            select: jest.fn(() => Promise.resolve({ data: [], error: null })),
          };
        }),
      } as unknown as import('@supabase/supabase-js').SupabaseClient;

      await hydrateCalibrationCache(mockDb);
      await hydrateCalibrationCache(mockDb); // within TTL
      expect(callCount).toBe(1);

      await new Promise((r) => setTimeout(r, 80));
      await hydrateCalibrationCache(mockDb); // past TTL
      expect(callCount).toBe(2);
    });
  });
});
