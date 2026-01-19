/**
 * ESLint rule to disallow arbitrary text size values in Tailwind classes.
 *
 * Enforces standard Tailwind text sizes (text-xs, text-sm, text-base, etc.)
 * instead of arbitrary values like text-[14px] or text-[0.8rem].
 *
 * See docs/docs_overall/design_style_guide.md for typography guidelines.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow arbitrary text size values in Tailwind classes',
      category: 'Design System',
    },
    messages: {
      noArbitraryTextSize:
        "Use Tailwind text size class instead of arbitrary '{{value}}'. Use: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, etc.",
    },
  },
  create(context) {
    // Matches text-[14px], text-[0.8rem], text-[1.5em], etc.
    const arbitraryTextSizeRegex = /\btext-\[[\d.]+(?:px|rem|em|%|vh|vw)\]/g;

    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;

      const matches = value.matchAll(arbitraryTextSizeRegex);
      for (const match of matches) {
        context.report({
          node,
          messageId: 'noArbitraryTextSize',
          data: { value: match[0] },
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
