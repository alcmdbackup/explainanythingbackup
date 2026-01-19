/**
 * ESLint rule to prefer warm shadow variants over standard Tailwind shadows.
 *
 * Enforces shadow-warm-* classes instead of generic shadow-sm/md/lg/xl/2xl.
 * Warm shadows use amber-tinted colors that match the design system aesthetic.
 *
 * See docs/docs_overall/design_style_guide.md for shadow token reference.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer warm shadow variants over standard Tailwind shadows',
      category: 'Design System',
    },
    messages: {
      preferWarmShadow:
        "Use 'shadow-warm-{{size}}' instead of 'shadow-{{size}}' for design system consistency",
    },
  },
  create(context) {
    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;

      // Use matchAll with new regex each time to avoid lastIndex bug
      const matches = value.matchAll(/\bshadow-(sm|md|lg|xl|2xl)\b/g);
      for (const match of matches) {
        // Skip if already using warm variant
        if (value.includes(`shadow-warm-${match[1]}`)) continue;

        context.report({
          node,
          messageId: 'preferWarmShadow',
          data: { size: match[1] },
        });
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
      // Handle cn()/clsx() calls
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
      // Handle LogicalExpression: condition && "shadow-xl"
      if (node.type === 'LogicalExpression') {
        return [...extractClassStrings(node.left), ...extractClassStrings(node.right)];
      }
      // Handle ConditionalExpression: condition ? "shadow-xl" : "shadow-sm"
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
