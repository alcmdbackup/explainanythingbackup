// Tests for ai-panel-variants — verifies the resolver rejects unknown strings
// and Object.prototype-key attacks, and that the registry stays well-formed
// (every slot non-empty, every key reachable, DEFAULT is a valid key).

import {
  PANEL_VARIANTS,
  DEFAULT_PANEL_VARIANT,
  resolvePanelVariant,
  PANEL_VARIANT_OPTIONS,
  type PanelVariant,
} from './ai-panel-variants';

const ALL_SLOTS: Array<keyof PANEL_VARIANTS_STYLE> = [
  'container',
  'header',
  'headerTitle',
  'headerIcon',
  'modeToggleWrapper',
  'section',
  'sectionLabel',
  'textarea',
  'submitButton',
  'quickActions',
  'quickActionLink',
  'historyWrapper',
  'historyButton',
  'historyItem',
  'loadingCard',
  'errorCard',
  'successCard',
];
type PANEL_VARIANTS_STYLE = (typeof PANEL_VARIANTS)[PanelVariant]['styles'];

describe('ai-panel-variants', () => {
  describe('PANEL_VARIANTS registry', () => {
    it('has exactly 7 variants (1 legacy + 6 new one-block)', () => {
      expect(Object.keys(PANEL_VARIANTS).sort()).toEqual(
        [
          'lined-paper',
          'parchment',
          'vellum',
          'focused-minimal',
          'embossed',
          'ink-stamped',
          'gilded-edge',
        ].sort(),
      );
    });

    it('every slot on every variant is a non-empty string', () => {
      for (const [key, config] of Object.entries(PANEL_VARIANTS)) {
        for (const slot of ALL_SLOTS) {
          const value = config.styles[slot];
          expect(typeof value).toBe('string');
          expect(value.trim().length).toBeGreaterThan(0);
          expect(value).not.toContain('undefined');
          if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`${key}.${slot} is empty`);
          }
        }
      }
    });

    it('every variant has correct id matching its registry key', () => {
      for (const [key, config] of Object.entries(PANEL_VARIANTS)) {
        expect(config.id).toBe(key);
      }
    });

    it('every variant has non-empty name and description', () => {
      for (const config of Object.values(PANEL_VARIANTS)) {
        expect(config.name.length).toBeGreaterThan(0);
        expect(config.description.length).toBeGreaterThan(0);
      }
    });

    it('DEFAULT_PANEL_VARIANT is a valid key', () => {
      expect(
        Object.prototype.hasOwnProperty.call(PANEL_VARIANTS, DEFAULT_PANEL_VARIANT),
      ).toBe(true);
      expect(PANEL_VARIANTS[DEFAULT_PANEL_VARIANT]).toBeDefined();
    });

    it('legacy lined-paper keeps its gold-banner header (backward compat)', () => {
      const linedPaper = PANEL_VARIANTS['lined-paper'];
      expect(linedPaper.styles.header).toContain('bg-gradient-to-br');
      expect(linedPaper.styles.headerTitle).toContain('text-on-primary');
    });

    it('NEW one-block variants do NOT have a colored header banner', () => {
      const oneBlockKeys: PanelVariant[] = [
        'parchment',
        'vellum',
        'focused-minimal',
        'embossed',
        'ink-stamped',
        'gilded-edge',
      ];
      for (const key of oneBlockKeys) {
        const cfg = PANEL_VARIANTS[key];
        expect(cfg.styles.header).not.toContain('bg-gradient-to-br');
        expect(cfg.styles.header).not.toContain('border-b-2');
        // Title should be dark text on body surface, not white-on-gold.
        expect(cfg.styles.headerTitle).toContain('text-[var(--text-primary)]');
        expect(cfg.styles.headerTitle).not.toContain('text-on-primary');
      }
    });
  });

  describe('PANEL_VARIANT_OPTIONS', () => {
    it('has one option per variant', () => {
      expect(PANEL_VARIANT_OPTIONS).toHaveLength(Object.keys(PANEL_VARIANTS).length);
    });

    it('each option has value, label, description', () => {
      for (const opt of PANEL_VARIANT_OPTIONS) {
        expect(opt.value).toBeDefined();
        expect(opt.label).toBeDefined();
        expect(opt.description).toBeDefined();
      }
    });
  });

  describe('resolvePanelVariant — valid inputs', () => {
    it.each(Object.keys(PANEL_VARIANTS) as PanelVariant[])(
      'returns %s when called with %s (round-trip)',
      (key) => {
        expect(resolvePanelVariant(key)).toBe(key);
      },
    );
  });

  describe('resolvePanelVariant — fallback inputs', () => {
    it('returns default for null', () => {
      expect(resolvePanelVariant(null)).toBe(DEFAULT_PANEL_VARIANT);
    });

    it('returns default for undefined', () => {
      expect(resolvePanelVariant(undefined)).toBe(DEFAULT_PANEL_VARIANT);
    });

    it('returns default for empty string', () => {
      expect(resolvePanelVariant('')).toBe(DEFAULT_PANEL_VARIANT);
    });

    it('returns default for unknown string', () => {
      expect(resolvePanelVariant('garbage')).toBe(DEFAULT_PANEL_VARIANT);
      expect(resolvePanelVariant('Parchment')).toBe(DEFAULT_PANEL_VARIANT); // case-sensitive
    });
  });

  describe('resolvePanelVariant — Object.prototype attack inputs', () => {
    it.each([
      'toString',
      '__proto__',
      'hasOwnProperty',
      'constructor',
      'valueOf',
      'isPrototypeOf',
    ])('returns default for Object.prototype key "%s"', (key) => {
      expect(resolvePanelVariant(key)).toBe(DEFAULT_PANEL_VARIANT);
    });
  });

  describe('console.warn behavior', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('fires console.warn for unknown non-empty strings', () => {
      resolvePanelVariant('garbage');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('ai-panel-variants');
      expect(warnSpy.mock.calls[0][0]).toContain('garbage');
    });

    it('does NOT fire console.warn for null', () => {
      resolvePanelVariant(null);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for undefined', () => {
      resolvePanelVariant(undefined);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for empty string', () => {
      resolvePanelVariant('');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for valid variants', () => {
      for (const key of Object.keys(PANEL_VARIANTS)) {
        resolvePanelVariant(key);
      }
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
