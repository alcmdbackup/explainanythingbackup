/**
 * ESLint rule to detect duplicate header/label string literals in column definition arrays.
 *
 * Flags arrays of objects where multiple entries share the same static `header` or `label` value,
 * which causes confusing UI columns and broken sort/filter behavior.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow duplicate header/label string literals in column definition arrays',
      category: 'Best Practices',
    },
    messages: {
      duplicateColumnLabel:
        "Duplicate column {{ property }}: '{{ value }}'. Each column must have a unique {{ property }}.",
    },
    schema: [],
  },
  create(context) {
    return {
      ArrayExpression(node) {
        // Only check arrays where elements are object expressions
        const objects = node.elements.filter(
          (el) => el && el.type === 'ObjectExpression'
        );
        if (objects.length < 2) return;

        for (const property of ['header', 'label']) {
          const seen = new Map(); // value -> first node

          for (const obj of objects) {
            const prop = obj.properties.find(
              (p) =>
                p.type === 'Property' &&
                p.key.type === 'Identifier' &&
                p.key.name === property &&
                p.value.type === 'Literal' &&
                typeof p.value.value === 'string'
            );
            if (!prop) continue;

            const value = prop.value.value;
            if (seen.has(value)) {
              context.report({
                node: prop.value,
                messageId: 'duplicateColumnLabel',
                data: { property, value },
              });
            } else {
              seen.set(value, prop.value);
            }
          }
        }
      },
    };
  },
};
