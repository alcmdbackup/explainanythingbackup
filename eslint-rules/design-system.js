/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ESLint plugin for design system enforcement rules.
 *
 * Rules:
 * - no-hardcoded-colors: Disallow hardcoded hex/rgba colors in style props
 * - no-arbitrary-text-sizes: Disallow arbitrary text-[Xpx] in Tailwind classes
 * - prefer-design-system-fonts: Prefer font-body/font-ui over font-serif/font-sans
 * - prefer-warm-shadows: Prefer shadow-warm-* over shadow-sm/md/lg/xl/2xl
 *
 * See docs/docs_overall/design_style_guide.md for design token reference.
 */
module.exports = {
  rules: {
    'no-hardcoded-colors': require('./no-hardcoded-colors'),
    'no-arbitrary-text-sizes': require('./no-arbitrary-text-sizes'),
    'prefer-design-system-fonts': require('./prefer-design-system-fonts'),
    'prefer-warm-shadows': require('./prefer-warm-shadows'),
  },
};
