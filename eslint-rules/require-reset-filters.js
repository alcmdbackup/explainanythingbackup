/**
 * ESLint rule to require resetFilters() (or equivalent reset call) in admin
 * E2E specs that seed [TEST]-prefixed data.
 *
 * Admin list pages default `filterTestContent=true` which hides [TEST]% rows.
 * Tests that seed [TEST]-prefixed data MUST reset the UI's default filter state
 * before asserting on those rows. The four admin-content.spec.ts failures in
 * PR #930 post-merge were all caused by this exact pattern.
 *
 * Detection: in each `test(...)` (or `adminTest(...)`) callback body, if the
 * body contains a string literal starting with '[TEST]' AND does NOT contain
 * a CallExpression whose property name matches /^reset(Filters|Search)$/,
 * flag the test.
 *
 * Heuristic, scoped to admin specs only — see canonical Phase 3 for the
 * severity contingency (downgrade to `warn` if >3 false positives).
 *
 * See docs/docs_overall/testing_overview.md Rule 1.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require resetFilters() call in admin specs that seed [TEST]-prefixed data',
      category: 'Best Practices',
    },
    messages: {
      requireReset:
        'Test seeds [TEST]-prefixed data but does not call resetFilters() — ' +
        'admin pages default filterTestContent=true and will hide the seeded rows. ' +
        'Add `await <page>.resetFilters()` after navigation. See testing_overview.md Rule 1.',
    },
    schema: [],
  },
  create(context) {
    const RESET_RE = /^reset(Filters|Search)$/;
    const TEST_PREFIX_RE = /^\[TEST\]/;

    function isTestCall(node) {
      if (node.callee.type !== 'Identifier') return false;
      return node.callee.name === 'test' || node.callee.name === 'adminTest';
    }

    function getCallback(node) {
      // test('name', cb) — last argument is the callback
      // test('name', { tag: '@critical' }, cb) — also last argument
      // adminTest(...) — same shape
      const args = node.arguments;
      if (args.length < 2) return null;
      const last = args[args.length - 1];
      if (
        last.type === 'ArrowFunctionExpression' ||
        last.type === 'FunctionExpression'
      ) {
        return last;
      }
      return null;
    }

    /**
     * Walk a subtree looking for:
     *   - any string Literal whose value starts with `[TEST]`
     *   - any CallExpression whose .property.name matches /^reset(Filters|Search)$/
     */
    function scanBody(rootNode) {
      let hasTestLiteral = false;
      let hasResetCall = false;

      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (hasTestLiteral && hasResetCall) return; // early exit

        // Check string literals
        if (
          node.type === 'Literal' &&
          typeof node.value === 'string' &&
          TEST_PREFIX_RE.test(node.value)
        ) {
          hasTestLiteral = true;
        }
        // Check template literal first chunks
        if (node.type === 'TemplateElement' && node.value && node.value.cooked) {
          if (TEST_PREFIX_RE.test(node.value.cooked)) {
            hasTestLiteral = true;
          }
        }
        // Check CallExpression for reset method
        if (
          node.type === 'CallExpression' &&
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.property &&
          node.callee.property.type === 'Identifier' &&
          RESET_RE.test(node.callee.property.name)
        ) {
          hasResetCall = true;
        }

        // Recurse into children
        for (const key of Object.keys(node)) {
          if (key === 'parent' || key === 'loc' || key === 'range') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            for (const c of child) walk(c);
          } else if (child && typeof child === 'object' && child.type) {
            walk(child);
          }
        }
      }

      walk(rootNode);
      return { hasTestLiteral, hasResetCall };
    }

    return {
      CallExpression(node) {
        if (!isTestCall(node)) return;
        const cb = getCallback(node);
        if (!cb) return;

        const { hasTestLiteral, hasResetCall } = scanBody(cb.body);
        if (hasTestLiteral && !hasResetCall) {
          context.report({
            node,
            messageId: 'requireReset',
          });
        }
      },
    };
  },
};
