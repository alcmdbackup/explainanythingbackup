/**
 * ESLint rule to enforce design system typography on heading elements.
 *
 * Ensures heading elements (h1-h4) use correct font and size per design system:
 *   - h1: font-display + text-4xl (2.25rem)
 *   - h2: font-display + text-2xl (1.75rem)
 *   - h3: font-display + text-xl (1.375rem)
 *   - h4: font-display + text-lg (1.125rem)
 *
 * See docs/docs_overall/design_style_guide.md for typography scale reference.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce design system typography on heading elements',
      category: 'Design System',
    },
    messages: {
      wrongHeadingSize:
        "{{element}} should use '{{expected}}' instead of '{{actual}}' per design system scale",
      missingHeadingFont: "{{element}} should include 'font-display' class for heading typography",
      noInlineFontSize: "Use Tailwind text-* class instead of inline fontSize on {{element}}",
    },
  },
  create(context) {
    // Design system heading sizes
    const headingSizes = {
      h1: { expected: 'text-4xl', wrong: ['text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm'] },
      h2: { expected: 'text-2xl', wrong: ['text-xl', 'text-lg', 'text-base', 'text-sm'] },
      h3: { expected: 'text-xl', wrong: ['text-lg', 'text-base', 'text-sm'] },
      h4: { expected: 'text-lg', wrong: ['text-base', 'text-sm'] },
    };

    // Utility function names that accept class strings
    const classUtilities = new Set(['cn', 'clsx', 'classnames', 'cva', 'twMerge']);

    function extractClassValue(attrValue) {
      if (!attrValue) return '';
      if (attrValue.type === 'Literal' && typeof attrValue.value === 'string') {
        return attrValue.value;
      }
      if (attrValue.type === 'JSXExpressionContainer') {
        return extractFromExpression(attrValue.expression);
      }
      return '';
    }

    function extractFromExpression(expr) {
      if (expr.type === 'Literal' && typeof expr.value === 'string') {
        return expr.value;
      }
      if (expr.type === 'TemplateLiteral') {
        return expr.quasis.map((q) => q.value.raw).join(' ');
      }
      if (expr.type === 'CallExpression') {
        const calleeName = expr.callee.type === 'Identifier' ? expr.callee.name : null;
        if (calleeName && classUtilities.has(calleeName)) {
          return expr.arguments.map((arg) => extractFromExpression(arg)).join(' ');
        }
      }
      if (expr.type === 'ConditionalExpression') {
        return extractFromExpression(expr.consequent) + ' ' + extractFromExpression(expr.alternate);
      }
      if (expr.type === 'LogicalExpression') {
        return extractFromExpression(expr.left) + ' ' + extractFromExpression(expr.right);
      }
      return '';
    }

    function hasInlineFontSize(styleAttr) {
      if (!styleAttr || !styleAttr.value) return false;
      if (styleAttr.value.type !== 'JSXExpressionContainer') return false;

      const expr = styleAttr.value.expression;
      if (expr.type !== 'ObjectExpression') return false;

      return expr.properties.some((prop) => {
        if (prop.type !== 'Property') return false;
        const keyName = prop.key.type === 'Identifier' ? prop.key.name : null;
        return keyName === 'fontSize';
      });
    }

    return {
      JSXOpeningElement(node) {
        // Only check native heading elements (not components)
        if (node.name.type !== 'JSXIdentifier') return;
        const tagName = node.name.name;
        if (!headingSizes[tagName]) return;

        const config = headingSizes[tagName];

        // Find className attribute
        const classAttr = node.attributes.find(
          (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
        );

        // Find style attribute
        const styleAttr = node.attributes.find(
          (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'style'
        );

        if (classAttr) {
          const classValue = extractClassValue(classAttr.value);

          // Check for wrong size classes
          for (const wrongSize of config.wrong) {
            // Use word boundary to avoid matching partial class names
            const regex = new RegExp(`\\b${wrongSize}\\b`);
            if (regex.test(classValue)) {
              context.report({
                node,
                messageId: 'wrongHeadingSize',
                data: { element: tagName, expected: config.expected, actual: wrongSize },
              });
              break; // Only report one size error per heading
            }
          }

          // Check for missing font-display (also accept atlas-display as legacy)
          if (!classValue.includes('font-display') && !classValue.includes('atlas-display')) {
            context.report({
              node,
              messageId: 'missingHeadingFont',
              data: { element: tagName },
            });
          }
        } else {
          // No className at all - missing font-display
          context.report({
            node,
            messageId: 'missingHeadingFont',
            data: { element: tagName },
          });
        }

        // Check for inline fontSize in style prop
        if (hasInlineFontSize(styleAttr)) {
          context.report({
            node,
            messageId: 'noInlineFontSize',
            data: { element: tagName },
          });
        }
      },
    };
  },
};
