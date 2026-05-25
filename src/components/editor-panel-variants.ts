// Editor-panel variant registry for the explanation results page wrapper
// (src/app/results/page.tsx). Lite variant of src/components/ai-panel-variants.ts
// (single-slot className map instead of multi-slot config objects). Variant is
// selected via the ?editorVariant=… URL search param; unknown values fall back
// to DEFAULT_EDITOR_PANEL_VARIANT.

export type EditorPanelVariant =
  | 'default'
  | 'parchment'
  | 'embossed'
  | 'vellum'
  | 'bracketed';

export const EDITOR_PANEL_VARIANTS: Record<EditorPanelVariant, string> = {
  default: 'scholar-card p-6',
  parchment: 'scholar-card paper-texture shadow-warm-lg p-6',
  embossed:
    'bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-page',
  vellum: 'vellum-editor rounded-book p-6 shadow-warm-md',
  bracketed: 'scholar-card card-enhanced p-8 shadow-warm-lg',
};

export const DEFAULT_EDITOR_PANEL_VARIANT: EditorPanelVariant = 'embossed';

export function resolveEditorPanelVariant(
  raw: string | null | undefined,
): EditorPanelVariant {
  // Defensive: avoid `raw in EDITOR_PANEL_VARIANTS` because the `in` operator
  // also matches inherited Object.prototype keys (toString, __proto__, etc.),
  // which would let ?editorVariant=toString slip past the whitelist and
  // produce className="undefined …". Use hasOwnProperty.call instead.
  if (raw && Object.prototype.hasOwnProperty.call(EDITOR_PANEL_VARIANTS, raw)) {
    return raw as EditorPanelVariant;
  }
  if (raw && process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
    // Aid A/B testing — silent fallback hides typos. Dev-only to keep prod consoles quiet.
    console.warn(
      `[editor-panel-variants] Unknown editorVariant="${raw}"; using ${DEFAULT_EDITOR_PANEL_VARIANT}.`,
    );
  }
  return DEFAULT_EDITOR_PANEL_VARIANT;
}
