/**
 * ESLint rule to disallow ordinal table cell selectors (`td:nth-child(N)` and
 * `tr:nth-child(N)`) in E2E specs.
 *
 * Adding/removing/reordering a column silently changes which cell nth-child(N)
 * selects, and the resulting failure is content-based (wrong assertion on wrong
 * column), not a "not found" error — making it harder to diagnose. Use
 * getByRole('cell', { name: ... }), data-testid per cell, or
 * getByRole('columnheader') indexing instead.
 *
 * See docs/docs_overall/testing_overview.md Rule 3.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow td:nth-child(N) and tr:nth-child(N) selectors in E2E specs',
      category: 'Best Practices',
    },
    messages: {
      noNthChildCell:
        'Avoid {{selector}} — adding/reordering columns silently breaks this. ' +
        "Use getByRole('cell', { name: '...' }) or a data-testid per cell. " +
        'See testing_overview.md Rule 3.',
    },
    schema: [],
  },
  create(context) {
    // Match `td:nth-child(N)` or `tr:nth-child(N)` anywhere in a string
    const NTH_CHILD_RE = /\b(?:td|tr):nth-child\(\d+\)/;

    function checkString(node, value) {
      if (typeof value !== 'string') return;
      const m = value.match(NTH_CHILD_RE);
      if (m) {
        context.report({
          node,
          messageId: 'noNthChildCell',
          data: { selector: m[0] },
        });
      }
    }

    return {
      Literal(node) {
        checkString(node, node.value);
      },
      TemplateElement(node) {
        // Template literal chunks: `tr:nth-child(${i}) td:nth-child(4)` —
        // node.value.cooked is the literal text between interpolations
        checkString(node, node.value && node.value.cooked);
      },
    };
  },
};
