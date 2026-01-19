/**
 * ESLint rule to prefer design system font classes over generic Tailwind fonts.
 *
 * Enforces font-body and font-ui over generic font-serif and font-sans.
 * Design system fonts ensure typographic consistency across the application.
 *
 * See docs/docs_overall/design_style_guide.md for font token reference.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer design system font classes over generic Tailwind fonts',
      category: 'Design System',
    },
    messages: {
      preferFontBody: "Use 'font-body' instead of 'font-serif' for body text",
      preferFontUi: "Use 'font-ui' instead of 'font-sans' for UI elements",
    },
  },
  create(context) {
    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;

      if (/\bfont-serif\b/.test(value)) {
        context.report({ node, messageId: 'preferFontBody' });
      }
      if (/\bfont-sans\b/.test(value)) {
        context.report({ node, messageId: 'preferFontUi' });
      }
    }

    function extractClassStrings(node) {
      // Handle Literal: "string"
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return [{ node, value: node.value }];
      }
      // Handle TemplateLiteral: `string` (only static parts)
      if (node.type === 'TemplateLiteral') {
        return node.quasis.map((quasi) => ({ node, value: quasi.value.raw }));
      }
      // Handle cn()/clsx() calls: cn("font-serif", condition && "other")
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
      // Handle LogicalExpression: condition && "font-serif"
      if (node.type === 'LogicalExpression') {
        return [...extractClassStrings(node.left), ...extractClassStrings(node.right)];
      }
      // Handle ConditionalExpression: condition ? "font-serif" : "font-sans"
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
