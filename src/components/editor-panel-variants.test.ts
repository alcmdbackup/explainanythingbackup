// Tests for editor-panel-variants — verifies the resolver rejects unknown
// strings and Object.prototype-key attacks, and that the registry stays
// well-formed (every variant string non-empty, contains a padding token,
// DEFAULT is a valid key).

import {
  EDITOR_PANEL_VARIANTS,
  DEFAULT_EDITOR_PANEL_VARIANT,
  resolveEditorPanelVariant,
  type EditorPanelVariant,
} from './editor-panel-variants';

describe('editor-panel-variants', () => {
  describe('EDITOR_PANEL_VARIANTS registry', () => {
    it('every value is a non-empty string', () => {
      for (const [key, value] of Object.entries(EDITOR_PANEL_VARIANTS)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
        expect(value.trim()).toBe(value);
        // Sanity: should not contain the literal string 'undefined' (regression guard
        // for a resolver bug that would render className="undefined …").
        expect(value).not.toContain('undefined');
        // Light readability check — key name appears in error messages elsewhere.
        expect(key).toMatch(/^[a-z]+$/);
      }
    });

    it('every value contains a Tailwind padding token (guards against accidental padding drop)', () => {
      for (const [key, value] of Object.entries(EDITOR_PANEL_VARIANTS)) {
        expect(value).toMatch(/\bp-\d+\b/);
        // Surfaced in failure message so it's clear which variant regressed.
        if (!/\bp-\d+\b/.test(value)) {
          throw new Error(`variant ${key} is missing a p-* padding token: ${value}`);
        }
      }
    });

    it('DEFAULT_EDITOR_PANEL_VARIANT is a valid key', () => {
      expect(Object.prototype.hasOwnProperty.call(EDITOR_PANEL_VARIANTS, DEFAULT_EDITOR_PANEL_VARIANT)).toBe(true);
      expect(EDITOR_PANEL_VARIANTS[DEFAULT_EDITOR_PANEL_VARIANT]).toBeDefined();
    });
  });

  describe('resolveEditorPanelVariant — valid inputs', () => {
    it.each(Object.keys(EDITOR_PANEL_VARIANTS) as EditorPanelVariant[])(
      'returns %s when called with %s (round-trip)',
      (key) => {
        expect(resolveEditorPanelVariant(key)).toBe(key);
      },
    );
  });

  describe('resolveEditorPanelVariant — fallback inputs', () => {
    it('returns default for null', () => {
      expect(resolveEditorPanelVariant(null)).toBe(DEFAULT_EDITOR_PANEL_VARIANT);
    });

    it('returns default for undefined', () => {
      expect(resolveEditorPanelVariant(undefined)).toBe(DEFAULT_EDITOR_PANEL_VARIANT);
    });

    it('returns default for empty string', () => {
      expect(resolveEditorPanelVariant('')).toBe(DEFAULT_EDITOR_PANEL_VARIANT);
    });

    it('returns default for unknown string', () => {
      expect(resolveEditorPanelVariant('garbage')).toBe(DEFAULT_EDITOR_PANEL_VARIANT);
      expect(resolveEditorPanelVariant('Parchment')).toBe(DEFAULT_EDITOR_PANEL_VARIANT); // case-sensitive
    });
  });

  describe('resolveEditorPanelVariant — Object.prototype attack inputs', () => {
    // These keys exist on Object.prototype. A naive `raw in EDITOR_PANEL_VARIANTS`
    // check would return true for them and cause EDITOR_PANEL_VARIANTS[raw] to
    // be undefined, producing className="undefined …". The resolver MUST guard
    // against this by using hasOwnProperty.call.
    it.each(['toString', '__proto__', 'hasOwnProperty', 'constructor', 'valueOf', 'isPrototypeOf'])(
      'returns default for Object.prototype key "%s"',
      (key) => {
        expect(resolveEditorPanelVariant(key)).toBe(DEFAULT_EDITOR_PANEL_VARIANT);
      },
    );
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
      resolveEditorPanelVariant('garbage');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('editor-panel-variants');
      expect(warnSpy.mock.calls[0][0]).toContain('garbage');
    });

    it('does NOT fire console.warn for null', () => {
      resolveEditorPanelVariant(null);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for undefined', () => {
      resolveEditorPanelVariant(undefined);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for empty string', () => {
      resolveEditorPanelVariant('');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT fire console.warn for valid variants', () => {
      for (const key of Object.keys(EDITOR_PANEL_VARIANTS)) {
        resolveEditorPanelVariant(key);
      }
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
