/**
 * AI Panel Design Variants
 *
 * Monochromatic variants for AIEditorPanel and AdvancedAIEditorModal.
 * All variants use pure grayscale with focus on typography and alignment.
 * These variants only apply when Midnight Scholar theme is active.
 */

export type PanelVariant =
  | 'mono'
  | 'mono-tight'
  | 'mono-ruled'
  | 'mono-inset'
  | 'mono-airy';

export interface VariantStyles {
  container: string;
  header: string;
  section: string;
  input: string;
  button: string;
  buttonHover: string;
  toggle: string;
  toggleActive: string;
  toggleInactive: string;
}

export const PANEL_VARIANTS: Record<PanelVariant, { label: string; description: string }> = {
  mono: {
    label: 'Mono',
    description: 'Clean grayscale with balanced spacing',
  },
  'mono-tight': {
    label: 'Tight',
    description: 'Compact layout with precise alignment',
  },
  'mono-ruled': {
    label: 'Ruled',
    description: 'Subtle divider lines between sections',
  },
  'mono-inset': {
    label: 'Inset',
    description: 'Indented sections for clear hierarchy',
  },
  'mono-airy': {
    label: 'Airy',
    description: 'Generous whitespace, relaxed feel',
  },
};

export const variantStyles: Record<PanelVariant, VariantStyles> = {
  // Base mono: Clean grayscale with balanced proportions
  mono: {
    container: 'bg-[var(--surface-secondary)] border-l border-[var(--text-muted)]/20',
    header: 'border-b border-[var(--text-muted)]/15 pb-4 mb-1',
    section: 'py-4',
    input: 'bg-[var(--surface-primary)] border border-[var(--text-muted)]/25 rounded-md px-3 py-2.5 focus:ring-1 focus:ring-[var(--text-muted)]/40 focus:border-[var(--text-muted)]/50',
    button: 'bg-[var(--text-primary)] text-[var(--surface-primary)] rounded-md font-medium',
    buttonHover: 'hover:bg-[var(--text-secondary)] hover:shadow-sm',
    toggle: 'bg-[var(--surface-primary)] border border-[var(--text-muted)]/25 rounded-md',
    toggleActive: 'bg-[var(--text-primary)]/10 text-[var(--text-primary)] font-medium',
    toggleInactive: 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
  },

  // Tight: Compact spacing with precise grid alignment
  'mono-tight': {
    container: 'bg-[var(--surface-secondary)] border-l border-[var(--text-muted)]/15',
    header: 'border-b border-[var(--text-muted)]/10 pb-3 mb-0',
    section: 'py-3',
    input: 'bg-[var(--surface-primary)] border border-[var(--text-muted)]/20 rounded px-2.5 py-2 text-sm focus:ring-1 focus:ring-[var(--text-muted)]/30 focus:border-[var(--text-muted)]/40',
    button: 'bg-[var(--text-primary)] text-[var(--surface-primary)] rounded text-sm py-2 font-medium',
    buttonHover: 'hover:bg-[var(--text-secondary)]',
    toggle: 'bg-[var(--surface-primary)] border border-[var(--text-muted)]/20 rounded text-sm',
    toggleActive: 'bg-[var(--text-primary)]/8 text-[var(--text-primary)] font-medium',
    toggleInactive: 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
  },

  // Ruled: Clean horizontal rules separate sections
  'mono-ruled': {
    container: 'bg-[var(--surface-secondary)] border-l-2 border-[var(--text-muted)]/10',
    header: 'border-b-2 border-[var(--text-muted)]/12 pb-4 mb-2',
    section: 'py-4 border-b border-[var(--text-muted)]/8 last:border-b-0',
    input: 'bg-transparent border-0 border-b border-[var(--text-muted)]/20 rounded-none px-0 py-2.5 focus:border-[var(--text-primary)]/40 focus:ring-0',
    button: 'bg-[var(--text-primary)] text-[var(--surface-primary)] rounded-none border-2 border-[var(--text-primary)] font-medium',
    buttonHover: 'hover:bg-transparent hover:text-[var(--text-primary)]',
    toggle: 'bg-transparent border-b border-[var(--text-muted)]/15 rounded-none',
    toggleActive: 'border-[var(--text-primary)]/30 text-[var(--text-primary)] font-medium',
    toggleInactive: 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/25',
  },

  // Inset: Indented content creates clear visual hierarchy
  'mono-inset': {
    container: 'bg-[var(--surface-secondary)] border-l-4 border-[var(--text-muted)]/8',
    header: 'border-b border-[var(--text-muted)]/12 pb-4 mb-2 ml-0',
    section: 'py-4 pl-3 border-l-2 border-[var(--text-muted)]/6',
    input: 'bg-[var(--surface-primary)]/80 border border-[var(--text-muted)]/20 rounded-md px-3 py-2.5 focus:ring-1 focus:ring-[var(--text-muted)]/30 focus:border-[var(--text-muted)]/40 focus:bg-[var(--surface-primary)]',
    button: 'bg-[var(--text-primary)] text-[var(--surface-primary)] rounded-md font-medium ml-3',
    buttonHover: 'hover:bg-[var(--text-secondary)] hover:shadow-sm',
    toggle: 'bg-[var(--surface-primary)]/60 border border-[var(--text-muted)]/15 rounded-md',
    toggleActive: 'bg-[var(--text-primary)]/10 text-[var(--text-primary)] border-[var(--text-muted)]/25 font-medium',
    toggleInactive: 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-primary)]/80',
  },

  // Airy: Generous spacing for a relaxed, breathable feel
  'mono-airy': {
    container: 'bg-[var(--surface-primary)] border-l border-[var(--text-muted)]/10',
    header: 'pb-6 mb-2',
    section: 'py-6',
    input: 'bg-[var(--surface-secondary)]/40 border-0 rounded-lg px-4 py-3.5 focus:ring-2 focus:ring-[var(--text-muted)]/20 focus:bg-[var(--surface-secondary)]/60',
    button: 'bg-[var(--text-primary)] text-[var(--surface-primary)] rounded-lg py-3 font-medium',
    buttonHover: 'hover:bg-[var(--text-secondary)] hover:shadow-md',
    toggle: 'bg-[var(--surface-secondary)]/30 border-0 rounded-lg',
    toggleActive: 'bg-[var(--text-primary)]/8 text-[var(--text-primary)] font-medium',
    toggleInactive: 'text-[var(--text-muted)]/70 hover:text-[var(--text-muted)]',
  },
};

/**
 * Get variant styles for a given variant
 */
export function getVariantStyles(variant: PanelVariant): VariantStyles {
  return variantStyles[variant];
}

/**
 * Get all variant options for dropdown
 */
export function getVariantOptions(): Array<{ value: PanelVariant; label: string; description: string }> {
  return Object.entries(PANEL_VARIANTS).map(([value, { label, description }]) => ({
    value: value as PanelVariant,
    label,
    description,
  }));
}
