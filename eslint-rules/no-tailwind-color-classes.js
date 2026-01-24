/**
 * ESLint rule to disallow Tailwind color classes in favor of design system tokens.
 *
 * Enforces CSS variable tokens (e.g., bg-[var(--status-success)]) instead of
 * Tailwind palette colors (e.g., bg-green-50, text-red-700).
 *
 * See docs/docs_overall/design_style_guide.md for design token reference.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Tailwind color classes; use design system tokens',
      category: 'Design System',
    },
    messages: {
      noTailwindColor:
        "Use design system token instead of '{{class}}'. Example: bg-[var(--status-success)]",
    },
  },
  create(context) {
    // Tailwind color palettes to detect
    const colorPattern =
      /\b(bg|text|border|ring|outline|from|via|to)-(red|green|blue|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose|white|black)-\d{1,3}\b/g;

    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;

      // Reset regex lastIndex for each check
      const matches = value.matchAll(colorPattern);
      for (const match of matches) {
        context.report({
          node,
          messageId: 'noTailwindColor',
          data: { class: match[0] },
        });
      }
    }

    function extractClassStrings(node) {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return [{ node, value: node.value }];
      }
      if (node.type === 'TemplateLiteral') {
        return node.quasis.map((quasi) => ({ node, value: quasi.value.raw }));
      }
      if (node.type === 'CallExpression') {
        const calleeName = node.callee.type === 'Identifier' ? node.callee.name : null;
        if (calleeName && classUtilities.has(calleeName)) {
          const results = [];
          for (const arg of node.arguments) {
            results.push(...extractClassStrings(arg));
          }
          return results;
        }
      }
      if (node.type === 'LogicalExpression') {
        return [...extractClassStrings(node.left), ...extractClassStrings(node.right)];
      }
      if (node.type === 'ConditionalExpression') {
        return [...extractClassStrings(node.consequent), ...extractClassStrings(node.alternate)];
      }
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== 'className') return;

        if (node.value?.type === 'Literal') {
          checkClassString(node, node.value.value);
        } else if (node.value?.type === 'JSXExpressionContainer') {
          const extracted = extractClassStrings(node.value.expression);
          for (const { node: n, value } of extracted) {
            checkClassString(n, value);
          }
        }
      },
    };
  },
};
