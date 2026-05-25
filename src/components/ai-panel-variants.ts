/**
 * AI Editor Panel Design Variants
 *
 * Each variant supplies an 18-slot className config that AIEditorPanel applies
 * to its container, header, sections, textarea, submit button, history items,
 * and status cards. Variants are selected at runtime via PanelVariantContext —
 * URL param `?panelVariant=…` wins, then localStorage, then the default.
 *
 * Adding a variant:
 *   1. Add a new id to the PanelVariant union.
 *   2. Build the PanelVariantConfig (use makeOneBlockVariant for one-block / no-colored-header styles).
 *   3. Register in PANEL_VARIANTS.
 *   4. resolvePanelVariant + the dropdown + tests pick it up automatically.
 *
 * 'lined-paper' is the legacy variant with a gold-gradient header banner — kept
 * for backward compat with users who already have it stored in localStorage.
 * All NEW variants are single-block / no-colored-header per design constraint.
 */

export type PanelVariant =
  | 'lined-paper'
  | 'parchment'
  | 'vellum'
  | 'focused-minimal'
  | 'embossed'
  | 'ink-stamped'
  | 'gilded-edge';

export interface PanelVariantConfig {
  id: PanelVariant;
  name: string;
  description: string;
  styles: {
    container: string;
    header: string;
    headerTitle: string;
    headerIcon: string;
    modeToggleWrapper: string;
    section: string;
    sectionLabel: string;
    textarea: string;
    submitButton: string;
    quickActions: string;
    quickActionLink: string;
    historyWrapper: string;
    historyButton: string;
    historyItem: string;
    loadingCard: string;
    errorCard: string;
    successCard: string;
  };
}

/** Input background - warm tinted to match scholarly aesthetic. */
const INPUT_BG = 'bg-[var(--surface-input)]';

// ============================================================================
// Legacy: lined-paper (gold-gradient header banner, keeps for backward compat)
// ============================================================================
const linedPaper: PanelVariantConfig = {
  id: 'lined-paper',
  name: 'Lined Paper',
  description: 'Clean scholarly style with gold header banner (legacy)',
  styles: {
    container: `
      bg-[var(--surface-elevated)]
      border-2 border-t-0 border-black/70
      shadow-warm-xl
      relative z-20
    `,
    header: `
      px-5 pt-5 pb-4
      bg-gradient-to-br from-[var(--accent-gold)] to-[color-mix(in_srgb,var(--accent-gold)_85%,var(--accent-copper))]
      border-b-2 border-b-[var(--accent-gold)]
    `,
    headerTitle: `
      text-3xl font-display font-semibold text-[var(--text-on-primary)]
      leading-tight
    `,
    headerIcon: `
      w-5 h-5 text-[var(--text-on-primary)]
    `,
    modeToggleWrapper: `px-5 py-3`,
    section: `py-4`,
    sectionLabel: `text-lg font-ui font-medium text-[var(--text-secondary)] mb-2`,
    textarea: `
      w-full h-40 px-3 py-2.5
      rounded-page border border-[var(--border-default)]
      ${INPUT_BG}
      text-[var(--text-primary)] font-body text-lg leading-relaxed
      placeholder:text-[var(--text-muted)]
      shadow-warm
      focus:outline-none focus:border-[var(--accent-gold)] focus:ring-2 focus:ring-[var(--accent-gold)]/30
      focus:bg-[var(--surface-secondary)]
      transition-all duration-200
      resize-none
    `,
    submitButton: `
      w-full h-11
      rounded-page
      font-ui font-medium text-base
      text-[var(--text-on-primary)]
      bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
      shadow-warm
      hover:shadow-warm-md hover:brightness-105
      active:brightness-95
      transition-all duration-200
      focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
    `,
    quickActions: `flex flex-wrap items-center gap-x-3 pt-3`,
    quickActionLink: `
      text-sm font-ui text-[var(--text-secondary)]
      hover:text-[var(--accent-copper)]
      transition-colors cursor-pointer
    `,
    historyWrapper: `px-5 py-4 border-t border-[var(--border-default)]`,
    historyButton: `
      w-full flex items-center justify-between
      text-base font-ui font-medium text-[var(--text-secondary)]
      hover:text-[var(--accent-gold)]
      transition-colors py-1
    `,
    historyItem: `
      w-full text-left py-3 px-3
      rounded-page
      border border-transparent
      font-body text-lg text-[var(--text-secondary)]
      hover:bg-[var(--surface-elevated)] hover:border-[var(--border-default)]
      transition-all duration-200 cursor-pointer
    `,
    loadingCard: `py-4`,
    errorCard: `py-3 pl-4 border-l-4 border-l-[var(--destructive)]`,
    successCard: `py-3 pl-4 border-l-4 border-l-[var(--accent-gold)]`,
  },
};

// ============================================================================
// One-block variant builder
// ============================================================================
// Shared slots for every "one block, no colored header" variant. Each variant
// only overrides the slots that differ visually (container, headerIcon, and
// optionally submitButton / textarea).
//
// Distinct from linedPaper: header has NO bg-gradient and NO border-b banner.
// Title text is dark (text-primary) on the body surface. Mode-toggle wrapper
// has just a top margin (no separator border) since header and body share one
// surface.

interface OneBlockOverrides {
  id: PanelVariant;
  name: string;
  description: string;
  container: string;
  headerIcon?: string;
  textarea?: string;
  submitButton?: string;
  historyWrapper?: string;
}

function makeOneBlockVariant(o: OneBlockOverrides): PanelVariantConfig {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    styles: {
      container: o.container,
      // No gradient, no border-b — header sits on the body surface.
      // pt-7 bumps the divider Y position to roughly align with the article
      // title's title-flourish divider on the main content area.
      // pb-5 gives breathing room between the title and the divider.
      header: `px-5 pt-7 pb-5`,
      headerTitle: `text-3xl font-display font-semibold text-[var(--text-primary)] leading-tight`,
      headerIcon: o.headerIcon ?? `w-5 h-5 text-[var(--accent-copper)]`,
      // Mode toggle now sits below the main divider in its own pinned region
      // (rendered between divider and scroll area in AIEditorPanel.tsx).
      modeToggleWrapper: `px-5 py-6`,
      section: `py-4`,
      sectionLabel: `text-lg font-ui font-medium text-[var(--text-secondary)] mb-2`,
      textarea:
        o.textarea ??
        `
        w-full h-40 px-3 py-2.5
        rounded-page border border-[var(--border-default)]
        ${INPUT_BG}
        text-[var(--text-primary)] font-body text-lg leading-relaxed
        placeholder:text-[var(--text-muted)]
        shadow-warm
        focus:outline-none focus:border-[var(--accent-gold)] focus:ring-2 focus:ring-[var(--accent-gold)]/30
        focus:bg-[var(--surface-secondary)]
        transition-all duration-200
        resize-none
      `,
      submitButton:
        o.submitButton ??
        `
        w-full h-11
        rounded-page
        font-ui font-medium text-base
        text-[var(--text-on-primary)]
        bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
        shadow-warm
        hover:shadow-warm-md hover:brightness-105
        active:brightness-95
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
      `,
      quickActions: `flex flex-wrap items-center gap-x-3 pt-3`,
      quickActionLink: `
        text-sm font-ui text-[var(--text-secondary)]
        hover:text-[var(--accent-copper)]
        transition-colors cursor-pointer
      `,
      historyWrapper:
        o.historyWrapper ??
        `px-5 py-4 border-t border-[var(--border-default)]/40`,
      historyButton: `
        w-full flex items-center justify-between
        text-base font-ui font-medium text-[var(--text-secondary)]
        hover:text-[var(--accent-gold)]
        transition-colors py-1
      `,
      historyItem: `
        w-full text-left py-3 px-3
        rounded-page
        border border-transparent
        font-body text-lg text-[var(--text-secondary)]
        hover:bg-[var(--surface-elevated)] hover:border-[var(--border-default)]
        transition-all duration-200 cursor-pointer
      `,
      loadingCard: `py-4`,
      errorCard: `py-3 pl-4 border-l-4 border-l-[var(--destructive)]`,
      successCard: `py-3 pl-4 border-l-4 border-l-[var(--accent-gold)]`,
    },
  };
}

// ============================================================================
// Six one-block variants
// ============================================================================

const parchment = makeOneBlockVariant({
  id: 'parchment',
  name: 'Parchment',
  description: 'Aged paper with subtle texture and warm copper accents',
  container: `
    bg-[var(--surface-secondary)] paper-texture
    border-2 border-t-0 border-black/70
    shadow-warm-xl
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--accent-copper)]`,
});

const vellum = makeOneBlockVariant({
  id: 'vellum',
  name: 'Vellum',
  description: 'Frosted glassmorphism — translucent body with backdrop blur',
  container: `
    vellum-panel
    border-2 border-t-0 border-black/70
    shadow-warm-xl
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--accent-gold)]`,
});

const focusedMinimal = makeOneBlockVariant({
  id: 'focused-minimal',
  name: 'Focused Minimal',
  description: 'Distraction-free with a single gold left edge accent',
  container: `
    focused-minimal-panel
    bg-[var(--surface-secondary)]
    shadow-warm-sm
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--accent-gold)]`,
  submitButton: `
    w-full h-9
    rounded-page
    font-ui font-medium text-sm
    text-[var(--accent-copper)]
    bg-transparent
    border border-[var(--accent-copper)]
    hover:bg-[var(--accent-copper)] hover:text-[var(--text-on-primary)]
    active:brightness-95
    transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
  `,
});

const embossed = makeOneBlockVariant({
  id: 'embossed',
  name: 'Embossed',
  description: 'Recessed book-page feel with inset paper shadow',
  container: `
    bg-[var(--surface-elevated)]
    border-2 border-t-0 border-[var(--border-default)]
    shadow-page
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--accent-copper)]`,
});

const inkStamped = makeOneBlockVariant({
  id: 'ink-stamped',
  name: 'Ink Stamped',
  description: 'Paper-texture body with a dark monochrome submit button',
  container: `
    bg-[var(--surface-secondary)] paper-texture
    border-2 border-t-0 border-black/70
    shadow-warm-xl
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--text-primary)]`,
  submitButton: `
    w-full h-9
    rounded-page
    font-ui font-medium text-sm
    text-[var(--surface-secondary)]
    bg-[var(--text-primary)]
    shadow-warm-md
    hover:brightness-110
    active:brightness-95
    transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
  `,
});

const gildedEdge = makeOneBlockVariant({
  id: 'gilded-edge',
  name: 'Gilded Edge',
  description: 'Refined surface with a subtle gold-copper right edge accent',
  container: `
    gilded-edge-panel
    bg-[var(--surface-secondary)]
    border-2 border-t-0 border-black/70
    shadow-warm-xl
    relative z-20
  `,
  headerIcon: `w-5 h-5 text-[var(--accent-gold)]`,
});

// ============================================================================
// Registry + resolver
// ============================================================================

export const PANEL_VARIANTS: Record<PanelVariant, PanelVariantConfig> = {
  'lined-paper': linedPaper,
  parchment,
  vellum,
  'focused-minimal': focusedMinimal,
  embossed,
  'ink-stamped': inkStamped,
  'gilded-edge': gildedEdge,
};

export const DEFAULT_PANEL_VARIANT: PanelVariant = 'embossed';

/**
 * Defensive resolver. Uses Object.prototype.hasOwnProperty.call to avoid
 * matching inherited Object.prototype keys (toString, __proto__, etc.) that
 * would otherwise let `?panelVariant=toString` produce a config of undefined.
 * Returns the default for null / undefined / '' / unknown / prototype keys.
 */
export function resolvePanelVariant(raw: string | null | undefined): PanelVariant {
  if (raw && Object.prototype.hasOwnProperty.call(PANEL_VARIANTS, raw)) {
    return raw as PanelVariant;
  }
  if (raw && process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
    console.warn(
      `[ai-panel-variants] Unknown panelVariant="${raw}"; using ${DEFAULT_PANEL_VARIANT}.`,
    );
  }
  return DEFAULT_PANEL_VARIANT;
}

/** Options for the PanelVariantSelector dropdown. */
export const PANEL_VARIANT_OPTIONS = Object.values(PANEL_VARIANTS).map(v => ({
  value: v.id,
  label: v.name,
  description: v.description,
}));
