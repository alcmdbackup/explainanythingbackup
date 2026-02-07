/**
 * ESLint rule to disallow inline fontSize and fontFamily in style props.
 *
 * All typography should use Tailwind classes (text-*, font-*) for consistency
 * with the design system. Inline styles bypass design token validation.
 *
 * See docs/docs_overall/design_style_guide.md for typography reference.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow inline fontSize and fontFamily in style props',
      category: 'Design System',
    },
    messages: {
      noInlineFontSize:
        "Use Tailwind text-* class instead of inline fontSize '{{value}}'. Design system sizes: text-sm, text-base, text-lg, text-xl, text-2xl, text-4xl",
      noInlineFontFamily:
        "Use font-display/font-body/font-ui/font-mono class instead of inline fontFamily '{{value}}'",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        // Only check style attributes
        if (node.name.name !== 'style') return;
        if (!node.value || node.value.type !== 'JSXExpressionContainer') return;

        const expr = node.value.expression;
        if (expr.type !== 'ObjectExpression') return;

        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue;

          // Get the key name
          const keyName = prop.key.type === 'Identifier' ? prop.key.name : null;
          if (!keyName) continue;

          // Check for fontSize
          if (keyName === 'fontSize') {
            const value = prop.value.type === 'Literal' ? String(prop.value.value) : '[dynamic]';
            context.report({
              node: prop,
              messageId: 'noInlineFontSize',
              data: { value },
            });
          }

          // Check for fontFamily
          if (keyName === 'fontFamily') {
            const value = prop.value.type === 'Literal' ? String(prop.value.value) : '[dynamic]';
            context.report({
              node: prop,
              messageId: 'noInlineFontFamily',
              data: { value },
            });
          }
        }
      },
    };
  },
};
