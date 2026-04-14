// Tests for the central model registry — contract tests, lookup helpers, and slashed ID validation.

import {
  MODEL_REGISTRY,
  DEFAULT_JUDGE_MODEL,
  getModelInfo,
  getModelMaxTemperature,
  getEvolutionModelIds,
  getModelOptions,
  isOpenRouterModel,
  getOpenRouterApiModelId,
  type ModelInfo,
  type ModelProvider,
} from './modelRegistry';
import { z } from 'zod';

describe('modelRegistry', () => {
  describe('contract tests', () => {
    const entries = Object.entries(MODEL_REGISTRY);

    it('has at least one model', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it('has at least one evolution model', () => {
      expect(getEvolutionModelIds().length).toBeGreaterThan(0);
    });

    it.each(entries)('%s has all required fields', (_id, info) => {
      expect(typeof info.id).toBe('string');
      expect(info.id.length).toBeGreaterThan(0);
      expect(typeof info.displayName).toBe('string');
      expect(info.displayName.length).toBeGreaterThan(0);
      expect(['openai', 'anthropic', 'deepseek', 'openrouter', 'local']).toContain(info.provider);
      expect(typeof info.inputPer1M).toBe('number');
      expect(info.inputPer1M).toBeGreaterThanOrEqual(0);
      expect(typeof info.outputPer1M).toBe('number');
      expect(info.outputPer1M).toBeGreaterThanOrEqual(0);
      expect(info.maxTemperature === null || typeof info.maxTemperature === 'number').toBe(true);
      expect(typeof info.supportsEvolution).toBe('boolean');
    });

    it.each(entries)('%s has id matching its registry key', (key, info) => {
      expect(info.id).toBe(key);
    });

    it('openrouter models have openRouterModelId set', () => {
      for (const [, info] of entries) {
        if (info.provider === 'openrouter') {
          expect(info.openRouterModelId).toBeDefined();
          expect(typeof info.openRouterModelId).toBe('string');
        }
      }
    });
  });

  describe('slashed model IDs', () => {
    it('qwen/qwen3-8b round-trips through Zod parse + JSON', () => {
      const schema = z.enum(getEvolutionModelIds() as [string, ...string[]]);
      const parsed = schema.parse('qwen/qwen3-8b');
      expect(parsed).toBe('qwen/qwen3-8b');

      const serialized = JSON.stringify({ model: parsed });
      const deserialized = JSON.parse(serialized);
      expect(deserialized.model).toBe('qwen/qwen3-8b');
    });

    it('google/gemini-2.5-flash-lite round-trips through Zod parse + JSON', () => {
      const schema = z.enum(getEvolutionModelIds() as [string, ...string[]]);
      const parsed = schema.parse('google/gemini-2.5-flash-lite');
      expect(parsed).toBe('google/gemini-2.5-flash-lite');

      const serialized = JSON.stringify({ model: parsed });
      const deserialized = JSON.parse(serialized);
      expect(deserialized.model).toBe('google/gemini-2.5-flash-lite');
    });
  });

  describe('getModelInfo', () => {
    it('returns info for known model', () => {
      const info = getModelInfo('gpt-4.1-mini');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('openai');
      expect(info!.displayName).toBe('GPT-4.1 Mini');
    });

    it('returns undefined for unknown model', () => {
      expect(getModelInfo('nonexistent-model')).toBeUndefined();
    });
  });

  describe('getModelMaxTemperature', () => {
    it('returns 2.0 for OpenAI models', () => {
      expect(getModelMaxTemperature('gpt-4.1-mini')).toBe(2.0);
    });

    it('returns 1.0 for Anthropic models', () => {
      expect(getModelMaxTemperature('claude-sonnet-4-20250514')).toBe(1.0);
    });

    it('returns null for o3-mini (temperature not supported)', () => {
      expect(getModelMaxTemperature('o3-mini')).toBeNull();
    });

    it('returns undefined for unknown models', () => {
      expect(getModelMaxTemperature('unknown')).toBeUndefined();
    });
  });

  describe('getEvolutionModelIds', () => {
    it('includes all supportsEvolution=true models', () => {
      const ids = getEvolutionModelIds();
      for (const [key, info] of Object.entries(MODEL_REGISTRY)) {
        if (info.supportsEvolution) {
          expect(ids).toContain(key);
        }
      }
    });

    it('excludes supportsEvolution=false models', () => {
      const ids = getEvolutionModelIds();
      for (const [key, info] of Object.entries(MODEL_REGISTRY)) {
        if (!info.supportsEvolution) {
          expect(ids).not.toContain(key);
        }
      }
    });
  });

  describe('getModelOptions', () => {
    it('returns {label, value} pairs', () => {
      const options = getModelOptions();
      expect(options.length).toBeGreaterThan(0);
      for (const opt of options) {
        expect(typeof opt.label).toBe('string');
        expect(typeof opt.value).toBe('string');
        expect(opt.label.length).toBeGreaterThan(0);
      }
    });

    it('includes new models', () => {
      const values = getModelOptions().map(o => o.value);
      expect(values).toContain('gpt-5-nano');
      expect(values).toContain('google/gemini-2.5-flash-lite');
      expect(values).toContain('qwen/qwen3-8b');
    });
  });

  describe('isOpenRouterModel', () => {
    it('returns true for gpt-oss-20b', () => {
      expect(isOpenRouterModel('gpt-oss-20b')).toBe(true);
    });

    it('returns true for google/gemini-2.5-flash-lite', () => {
      expect(isOpenRouterModel('google/gemini-2.5-flash-lite')).toBe(true);
    });

    it('returns true for qwen/qwen3-8b', () => {
      expect(isOpenRouterModel('qwen/qwen3-8b')).toBe(true);
    });

    it('returns false for OpenAI models', () => {
      expect(isOpenRouterModel('gpt-4.1-mini')).toBe(false);
    });

    it('returns false for unknown models', () => {
      expect(isOpenRouterModel('unknown')).toBe(false);
    });
  });

  describe('getOpenRouterApiModelId', () => {
    it('transforms gpt-oss-20b to openai/gpt-oss-20b', () => {
      expect(getOpenRouterApiModelId('gpt-oss-20b')).toBe('openai/gpt-oss-20b');
    });

    it('keeps qwen/qwen3-8b as-is', () => {
      expect(getOpenRouterApiModelId('qwen/qwen3-8b')).toBe('qwen/qwen3-8b');
    });

    it('keeps google/gemini-2.5-flash-lite as-is', () => {
      expect(getOpenRouterApiModelId('google/gemini-2.5-flash-lite')).toBe('google/gemini-2.5-flash-lite');
    });

    it('falls back to model ID for unknown models', () => {
      expect(getOpenRouterApiModelId('some-unknown')).toBe('some-unknown');
    });
  });

  describe('DEFAULT_JUDGE_MODEL', () => {
    it('is a valid evolution model', () => {
      expect(getEvolutionModelIds()).toContain(DEFAULT_JUDGE_MODEL);
    });

    it('is qwen-2.5-7b-instruct', () => {
      expect(DEFAULT_JUDGE_MODEL).toBe('qwen-2.5-7b-instruct');
    });
  });

  describe('qwen-2.5-7b-instruct entry', () => {
    it('is registered as an openrouter model', () => {
      const info = getModelInfo('qwen-2.5-7b-instruct');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('openrouter');
      expect(info!.displayName).toBe('Qwen 2.5 7B Instruct');
    });

    it('has correct pricing ($0.04 input / $0.10 output per 1M)', () => {
      const info = getModelInfo('qwen-2.5-7b-instruct');
      expect(info!.inputPer1M).toBe(0.04);
      expect(info!.outputPer1M).toBe(0.10);
    });

    it('has maxTemperature 2.0', () => {
      expect(getModelMaxTemperature('qwen-2.5-7b-instruct')).toBe(2.0);
    });

    it('supportsEvolution is true', () => {
      expect(getEvolutionModelIds()).toContain('qwen-2.5-7b-instruct');
    });

    it('routes to openrouter with qwen/qwen-2.5-7b-instruct api model', () => {
      expect(isOpenRouterModel('qwen-2.5-7b-instruct')).toBe(true);
      expect(getOpenRouterApiModelId('qwen-2.5-7b-instruct')).toBe('qwen/qwen-2.5-7b-instruct');
    });
  });
});
