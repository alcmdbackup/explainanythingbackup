/**
 * ESLint rule to enforce font-body on prose elements, not font-display.
 *
 * Prose elements (p, span, li, etc.) should use font-body for readability.
 * font-display is reserved for headings and display text.
 *
 * Exception: Elements with large text sizes (text-2xl, text-3xl, etc.) may
 * intentionally use font-display for decorative purposes.
 *
 * See docs/docs_overall/design_style_guide.md for typography reference.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce font-body on prose elements, not font-display',
      category: 'Design System',
    },
    messages: {
      useBodyFont:
        "Prose element <{{element}}> should use 'font-body' instead of 'font-display' for readability",
      noInlineFontFamily:
        "Use 'font-body' or 'font-ui' class instead of inline fontFamily on <{{element}}>",
    },
  },
  create(context) {
    // Prose elements that should typically use font-body
    const proseElements = new Set(['p', 'span', 'li', 'td', 'th', 'blockquote', 'figcaption']);

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

    function isIntentionalDisplayUsage(classValue) {
      // Allow font-display on elements styled as headings (large text sizes)
      return /\btext-(2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(classValue);
    }

    function hasInlineFontFamily(styleAttr) {
      if (!styleAttr || !styleAttr.value) return false;
      if (styleAttr.value.type !== 'JSXExpressionContainer') return false;

      const expr = styleAttr.value.expression;
      if (expr.type !== 'ObjectExpression') return false;

      return expr.properties.some((prop) => {
        if (prop.type !== 'Property') return false;
        const keyName = prop.key.type === 'Identifier' ? prop.key.name : null;
        return keyName === 'fontFamily';
      });
    }

    return {
      JSXOpeningElement(node) {
        // Only check native prose elements
        if (node.name.type !== 'JSXIdentifier') return;
        const tagName = node.name.name;
        if (!proseElements.has(tagName)) return;

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

          // Warn if using font-display on prose (unless intentional)
          if (classValue.includes('font-display') && !isIntentionalDisplayUsage(classValue)) {
            context.report({
              node,
              messageId: 'useBodyFont',
              data: { element: tagName },
            });
          }
        }

        // Check for inline fontFamily
        if (hasInlineFontFamily(styleAttr)) {
          context.report({
            node,
            messageId: 'noInlineFontFamily',
            data: { element: tagName },
          });
        }
      },
    };
  },
};
