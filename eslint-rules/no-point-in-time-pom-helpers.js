/**
 * ESLint rule to flag `expect(await <PomInstance>.<helper>()).<assertion>(...)`
 * patterns in E2E specs.
 *
 * Custom POM helpers that return Promise<T> are point-in-time checks when used
 * inside expect(await ...) — the helper runs once, the value is captured, and
 * the assertion never retries. This races with React hydration and streaming.
 *
 * Two correct patterns:
 *  1. Rewrite the helper to return a Locator, then `await expect(locator).toHaveText(x)`
 *  2. Use `await expect.poll(() => helper()).toEqual(x)` for computed values
 *
 * This rule complements the existing `flakiness/no-point-in-time-checks` rule
 * (which flags hardcoded Playwright methods like .textContent(), .isVisible()).
 * It does NOT modify that rule.
 *
 * Detection:
 * - Matches `expect(await <Identifier>.<Identifier>(...))` where the inner
 *   identifier matches /^[a-z]\w*Page$/ — camelCase instance ending in `Page`.
 * - Excludes Playwright's bare `page` fixture (doesn't end in capitalized `Page`).
 * - Excludes the `Page` class itself (must start with lowercase letter, not uppercase).
 *
 * See docs/docs_overall/testing_overview.md Rule 4.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow expect(await pomHelper()) — use expect.poll(() => pomHelper()) instead',
      category: 'Best Practices',
    },
    messages: {
      pointInTimePom:
        'Avoid `expect(await {{instance}}.{{method}}())` — the helper runs once and the assertion does not retry. ' +
        'Use `await expect.poll(() => {{instance}}.{{method}}()).toEqual(x)` instead. ' +
        'See testing_overview.md Rule 4.',
    },
    schema: [],
  },
  create(context) {
    // POM identifier convention: camelCase instance variable starting with
    // a lowercase letter and ending in `Page`. This excludes:
    //   - Playwright's bare `page` fixture (no capital `Page` at end)
    //   - The `Page` class itself (starts with uppercase, not a member access on an instance)
    const POM_INSTANCE_RE = /^[a-z]\w*Page$/;

    return {
      CallExpression(node) {
        // Match `expect(...)` calls
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'expect') {
          return;
        }
        if (node.arguments.length !== 1) return;

        const arg = node.arguments[0];
        // Must be `await <something>`
        if (arg.type !== 'AwaitExpression') return;

        const inner = arg.argument;
        // Must be `<Identifier>.<Identifier>(...)`
        if (inner.type !== 'CallExpression') return;
        if (inner.callee.type !== 'MemberExpression') return;
        if (inner.callee.object.type !== 'Identifier') return;
        if (inner.callee.property.type !== 'Identifier') return;

        const instanceName = inner.callee.object.name;
        const methodName = inner.callee.property.name;

        if (!POM_INSTANCE_RE.test(instanceName)) return;

        context.report({
          node,
          messageId: 'pointInTimePom',
          data: { instance: instanceName, method: methodName },
        });
      },
    };
  },
};
