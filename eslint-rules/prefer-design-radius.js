/**
 * ESLint rule to prefer design system radius tokens over generic Tailwind.
 *
 * Enforces rounded-book/rounded-page instead of rounded-md/rounded-lg.
 * Design system mapping:
 *   - rounded-md (0.375rem) → rounded-page (inputs, small elements)
 *   - rounded-lg (0.5rem) → rounded-book (cards, containers)
 *
 * See docs/docs_overall/design_style_guide.md for design token reference.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer design system radius tokens over generic Tailwind',
      category: 'Design System',
    },
    messages: {
      preferPageRadius: "Use 'rounded-page' instead of 'rounded-md' for design system consistency",
      preferBookRadius: "Use 'rounded-book' instead of 'rounded-lg' for design system consistency",
    },
  },
  create(context) {
    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;

      // Check for rounded-md (should be rounded-page)
      if (/\brounded-md\b/.test(value) && !value.includes('rounded-page')) {
        context.report({ node, messageId: 'preferPageRadius' });
      }

      // Check for rounded-lg (should be rounded-book)
      // Skip if already has rounded-book or uses responsive variant like sm:rounded-lg
      if (/\brounded-lg\b/.test(value) && !value.includes('rounded-book')) {
        context.report({ node, messageId: 'preferBookRadius' });
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
