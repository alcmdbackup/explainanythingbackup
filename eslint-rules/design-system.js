/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ESLint plugin for design system enforcement rules.
 *
 * Rules:
 * - no-hardcoded-colors: Disallow hardcoded hex/rgba colors in style props
 * - no-arbitrary-text-sizes: Disallow arbitrary text-[Xpx] in Tailwind classes
 * - prefer-design-system-fonts: Prefer font-body/font-ui over font-serif/font-sans
 * - prefer-warm-shadows: Prefer shadow-warm-* over shadow-sm/md/lg/xl/2xl
 * - no-tailwind-color-classes: Disallow Tailwind palette colors (bg-green-50, etc.)
 * - prefer-design-radius: Prefer rounded-book/rounded-page over rounded-md/rounded-lg
 * - enforce-heading-typography: Enforce correct font/size on h1-h4 elements
 * - enforce-prose-font: Enforce font-body on prose elements, not font-display
 * - no-inline-typography: Disallow inline fontSize/fontFamily in style props
 *
 * See docs/docs_overall/design_style_guide.md for design token reference.
 */
module.exports = {
  rules: {
    'no-hardcoded-colors': require('./no-hardcoded-colors'),
    'no-arbitrary-text-sizes': require('./no-arbitrary-text-sizes'),
    'prefer-design-system-fonts': require('./prefer-design-system-fonts'),
    'prefer-warm-shadows': require('./prefer-warm-shadows'),
    'no-tailwind-color-classes': require('./no-tailwind-color-classes'),
    'prefer-design-radius': require('./prefer-design-radius'),
    'enforce-heading-typography': require('./enforce-heading-typography'),
    'enforce-prose-font': require('./enforce-prose-font'),
    'no-inline-typography': require('./no-inline-typography'),
  },
};
