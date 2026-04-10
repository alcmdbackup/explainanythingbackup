/**
 * ESLint rule to disallow same-name nested describe blocks in E2E specs.
 *
 * Stacking `test.describe('Foo', () => { test.describe('Foo', () => {...}) })`
 * is confusing in test output ("Foo > Foo > test name") and trivially leads to
 * scope-related test.skip() bugs (the skip in the inner describe doesn't apply
 * to the outer describe's siblings, even though they share a name).
 *
 * Catches: test.describe, test.describe.serial, test.describe.parallel,
 * adminTest.describe, adminTest.describe.serial — full set of variants.
 *
 * See docs/docs_overall/testing_overview.md Rule 8.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow same-name nested describe blocks',
      category: 'Best Practices',
    },
    messages: {
      duplicateName:
        'Nested describe block has the same name "{{name}}" as an enclosing describe. ' +
        'This is confusing in test output and trivially leads to test.skip() scope bugs. ' +
        'Give the inner describe a distinct name. See testing_overview.md Rule 8.',
    },
    schema: [],
  },
  create(context) {
    // Stack of describe names currently in scope while traversing the AST
    const describeStack = [];

    function isDescribeCall(node) {
      // Match `test.describe(...)`, `adminTest.describe(...)`,
      // `test.describe.serial(...)`, `test.describe.parallel(...)`,
      // `adminTest.describe.serial(...)` etc.
      if (node.callee.type !== 'MemberExpression') return false;

      // Walk down member chain to find the root identifier
      let property = node.callee.property;
      let object = node.callee.object;

      // For `test.describe.serial(...)`: callee is `test.describe.serial`
      // -> object is `test.describe` (MemberExpression), property is `serial`
      if (
        property.type === 'Identifier' &&
        (property.name === 'serial' || property.name === 'parallel') &&
        object.type === 'MemberExpression'
      ) {
        property = object.property;
        object = object.object;
      }

      if (property.type !== 'Identifier' || property.name !== 'describe') {
        return false;
      }
      if (object.type !== 'Identifier') return false;
      return object.name === 'test' || object.name === 'adminTest';
    }

    function getDescribeName(node) {
      // First argument is the describe name. Could be a string literal or
      // a string inside an options object: test.describe('name', () => {...})
      // OR test.describe('name', { tag: '@critical' }, () => {...})
      const firstArg = node.arguments[0];
      if (!firstArg) return null;
      if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
        return firstArg.value;
      }
      return null;
    }

    return {
      CallExpression(node) {
        if (!isDescribeCall(node)) return;
        const name = getDescribeName(node);
        if (name === null) return;

        if (describeStack.includes(name)) {
          context.report({
            node,
            messageId: 'duplicateName',
            data: { name },
          });
        }
        describeStack.push(name);
      },
      'CallExpression:exit'(node) {
        if (!isDescribeCall(node)) return;
        const name = getDescribeName(node);
        if (name === null) return;
        // Pop the matching name from the stack (last occurrence)
        const idx = describeStack.lastIndexOf(name);
        if (idx !== -1) describeStack.splice(idx, 1);
      },
    };
  },
};
