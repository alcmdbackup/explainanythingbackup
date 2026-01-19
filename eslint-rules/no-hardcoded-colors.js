/**
 * ESLint rule to disallow hardcoded color values in style props.
 *
 * Enforces CSS variable usage for colors to ensure design system compliance
 * and theme consistency. Hardcoded colors don't respond to theme changes.
 *
 * See docs/docs_overall/design_style_guide.md for color token reference.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded color values in style props',
      category: 'Design System',
    },
    messages: {
      noHardcodedHex:
        "Use CSS variable instead of hardcoded hex '{{value}}'. Example: var(--text-primary)",
      noHardcodedRgba:
        "Use CSS variable instead of hardcoded rgba '{{value}}'. Example: var(--accent-gold)",
    },
  },
  create(context) {
    // Improved regex patterns:
    // - Hex: matches #fff, #ffffff, #ffffffff (with alpha)
    // - RGBA: uses balanced matching for nested var() calls
    const hexRegex = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/;

    // Simple rgba detection - allows var() inside but still flags
    // rgba(255, 255, 255, 0.5) but NOT rgba(var(--color-rgb), 0.5)
    const rgbaRegex = /rgba?\s*\(\s*\d/; // Starts with digit = hardcoded

    // CSS style property names that can contain colors
    const colorProperties = new Set([
      'color',
      'backgroundColor',
      'borderColor',
      'borderTopColor',
      'borderRightColor',
      'borderBottomColor',
      'borderLeftColor',
      'outlineColor',
      'textDecorationColor',
      'fill',
      'stroke',
      'background',
      'border',
      'boxShadow',
      'textShadow',
      'caretColor',
      'columnRuleColor',
    ]);

    function checkValue(node, value) {
      if (typeof value !== 'string') return;

      // Skip if using CSS variable
      if (value.includes('var(--')) return;

      if (hexRegex.test(value)) {
        context.report({
          node,
          messageId: 'noHardcodedHex',
          data: { value: value.match(hexRegex)[0] },
        });
      }

      if (rgbaRegex.test(value)) {
        context.report({
          node,
          messageId: 'noHardcodedRgba',
          data: { value: value.substring(0, 30) + (value.length > 30 ? '...' : '') },
        });
      }
    }

    function extractStringValue(node) {
      // Handle Literal: "string"
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return { node, value: node.value };
      }
      // Handle TemplateLiteral: `string` (no expressions)
      if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return { node, value: node.quasis[0].value.raw };
      }
      // Template literals WITH expressions are skipped intentionally:
      // Dynamic values like `#${hexValue}` are too complex to statically analyze.
      // These cases are rare and should be caught in code review.
      return null;
    }

    function checkObjectProperties(props, isStyleContext) {
      for (const prop of props) {
        if (prop.type !== 'Property') continue;

        // Get property name (key)
        const keyName =
          prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'Literal'
              ? prop.key.value
              : null;

        // Only check color-related properties to avoid false positives
        // on objects like { theme: '#fff' } which aren't style objects
        if (!isStyleContext && keyName && !colorProperties.has(keyName)) continue;

        const extracted = extractStringValue(prop.value);
        if (extracted) {
          checkValue(extracted.node, extracted.value);
        }
      }
    }

    return {
      // Check style={{ color: '#fff' }}
      JSXAttribute(node) {
        if (node.name.name !== 'style') return;
        if (node.value?.type !== 'JSXExpressionContainer') return;

        const expr = node.value.expression;
        if (expr.type === 'ObjectExpression') {
          checkObjectProperties(expr.properties, /* isStyleContext */ true);
        }
      },
      // Check const styles = { color: '#fff' } - only color properties
      // This avoids false positives on { theme: '#fff' } config objects
      VariableDeclarator(node) {
        if (node.init?.type !== 'ObjectExpression') return;

        // Check variable name - only check if name suggests style context
        const varName = node.id.type === 'Identifier' ? node.id.name.toLowerCase() : '';
        const isStyleVariable = varName.includes('style') || varName.includes('color');

        checkObjectProperties(node.init.properties, isStyleVariable);
      },
    };
  },
};
