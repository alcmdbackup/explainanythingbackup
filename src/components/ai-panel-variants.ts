/**
 * AI Editor Panel Design Variant
 * Single refined style matching /results page aesthetic
 * Typography and styling aligned with design_style_guide.md
 */

export type PanelVariant = 'lined-paper';

export interface PanelVariantConfig {
  id: PanelVariant;
  name: string;
  description: string;
  styles: {
    // Container styles
    container: string;
    // Header section
    header: string;
    headerTitle: string;
    headerIcon: string;
    // Mode toggle area
    modeToggleWrapper: string;
    // Content sections (prompt, sources, tags)
    section: string;
    sectionLabel: string;
    // Textarea
    textarea: string;
    // Submit button
    submitButton: string;
    // Quick actions
    quickActions: string;
    quickActionLink: string;
    // History section
    historyWrapper: string;
    historyButton: string;
    historyItem: string;
    // Status messages (loading, error, success)
    loadingCard: string;
    errorCard: string;
    successCard: string;
  };
}

/**
 * Input background - warm tinted to match scholarly aesthetic
 * Halfway between surface-primary (#faf7f2) and surface-elevated (#f5f0e6)
 */
const INPUT_BG = 'bg-[var(--surface-input)]';

/**
 * Lined Paper - Clean scholarly style
 *
 * Key patterns:
 * - Container: surface-elevated bg, left border, shadow-warm-lg for strong pop
 * - Buttons: rounded-page, h-9, shadow-warm, gold-copper gradient
 * - Inputs: rounded-page, border-default, warm background tint
 * - Labels: text-sm to match placeholder, sentence case, text-secondary
 * - Headers: font-display font-semibold
 * - Body: font-body (Source Serif 4)
 */
const linedPaper: PanelVariantConfig = {
  id: 'lined-paper',
  name: 'Lined Paper',
  description: 'Clean scholarly style matching results page',
  styles: {
    // Panel container - warm tinted with black outline for separation from nav (no top border)
    container: `
      bg-[var(--surface-elevated)]
      border-2 border-t-0 border-black/70
      shadow-warm-xl
      relative z-20
    `,

    // Header - dark gold with very subtle gradient
    header: `
      px-5 pt-5 pb-4
      bg-gradient-to-br from-[var(--accent-gold)] to-[color-mix(in_srgb,var(--accent-gold)_85%,var(--accent-copper))]
      border-b-2 border-b-[var(--accent-gold)]
    `,

    // Title - white text for contrast on dark gold background
    headerTitle: `
      text-xl font-display font-semibold text-[var(--text-on-primary)]
      leading-tight
    `,

    // Icon - white for visibility on dark gold background
    headerIcon: `
      w-5 h-5 text-[var(--text-on-primary)]
    `,

    // Mode toggle wrapper - subtle separator
    modeToggleWrapper: `
      mt-3 pt-4
      border-t border-[var(--border-default)]
    `,

    // Sections - clean vertical rhythm
    section: `
      py-4
    `,

    // Section labels - same size as input placeholder for visual balance
    sectionLabel: `
      text-sm font-ui font-medium text-[var(--text-secondary)]
      mb-2
    `,

    // Textarea - matches results page input style with warm background
    // Results inputs: rounded-page border border-[var(--border-default)] bg-[var(--surface-secondary)]
    textarea: `
      w-full h-24 px-3 py-2.5
      rounded-page border border-[var(--border-default)]
      ${INPUT_BG}
      text-[var(--text-primary)] font-body text-sm leading-relaxed
      placeholder:text-[var(--text-muted)]
      shadow-warm
      focus:outline-none focus:border-[var(--accent-gold)] focus:ring-2 focus:ring-[var(--accent-gold)]/30
      focus:bg-[var(--surface-secondary)]
      transition-all duration-200
      resize-none
    `,

    // Submit button - matches results page primary button
    // Results: rounded-page bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] shadow-warm h-9
    submitButton: `
      w-full h-9
      rounded-page
      font-ui font-medium text-sm
      text-[var(--text-on-primary)]
      bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
      shadow-warm
      hover:shadow-warm-md hover:brightness-105
      active:brightness-95
      transition-all duration-200
      focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
    `,

    // Quick actions - subtle text links
    quickActions: `
      flex flex-wrap items-center gap-x-3 pt-3
    `,

    // Quick action links - matches results page link style
    // Results: text-[var(--accent-gold)] hover:text-[var(--accent-copper)]
    quickActionLink: `
      text-xs font-ui text-[var(--text-secondary)]
      hover:text-[var(--accent-copper)]
      transition-colors cursor-pointer
    `,

    // History section wrapper
    historyWrapper: `
      px-5 py-4
      border-t border-[var(--border-default)]
    `,

    // History toggle button
    historyButton: `
      w-full flex items-center justify-between
      text-sm font-ui font-medium text-[var(--text-secondary)]
      hover:text-[var(--accent-gold)]
      transition-colors py-1
    `,

    // History item - matches results page card hover pattern
    historyItem: `
      w-full text-left py-3 px-3
      rounded-page
      border border-transparent
      font-body text-sm text-[var(--text-secondary)]
      hover:bg-[var(--surface-elevated)] hover:border-[var(--border-default)]
      transition-all duration-200 cursor-pointer
    `,

    // Loading card - minimal
    loadingCard: `
      py-4
    `,

    // Error card - left border accent (matches results page error style)
    // Results: border-l-4 border-l-[var(--destructive)]
    errorCard: `
      py-3 pl-4
      border-l-4 border-l-[var(--destructive)]
    `,

    // Success card - gold accent
    successCard: `
      py-3 pl-4
      border-l-4 border-l-[var(--accent-gold)]
    `,
  },
};

// Export variant
export const PANEL_VARIANTS: Record<PanelVariant, PanelVariantConfig> = {
  'lined-paper': linedPaper,
};

// Default variant
export const DEFAULT_PANEL_VARIANT: PanelVariant = 'lined-paper';

// Get variant options for dropdown (single option now)
export const PANEL_VARIANT_OPTIONS = Object.values(PANEL_VARIANTS).map(v => ({
  value: v.id,
  label: v.name,
  description: v.description,
}));
