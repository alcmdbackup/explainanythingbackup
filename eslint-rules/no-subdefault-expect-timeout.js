/**
 * ESLint rule to flag hardcoded per-assertion timeouts that are <= the local
 * `expect` config default (10000ms).
 *
 * Playwright's `expect` timeout is env-scaled by playwright.config.ts:
 *   local 10s  /  CI 20s  /  production 60s.
 * A hardcoded `{ timeout: N }` with N <= 10000 on a web-first assertion (or a
 * `locator.waitFor`) OVERRIDES that scaling to a single fixed value in every
 * env — so in CI/prod it actively SHRINKS the budget below the config default,
 * making the assertion more likely to flake under CI load, not less.
 *
 * Prefer relying on the config default (drop the `timeout` option), or — for a
 * genuinely slow operation — use a literal LARGER than the default (which won't
 * trip this rule). See testing_overview.md Rule 20.
 *
 * Note: registered as `warn` (not `error`) while the existing backlog of
 * sub-default literals is burned down; promote to `error` once clean.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flag hardcoded per-assertion timeouts <= the local expect default (shrinks CI/prod budget)',
      category: 'Best Practices',
    },
    messages: {
      subdefaultTimeout:
        'Hardcoded timeout {{value}}ms on .{{method}}() is <= the local expect default (10s) and shrinks the CI (20s)/prod (60s) budget. Drop the timeout option to use the env-scaled default, or use a value > 10000 for a deliberate long-poll. See testing_overview.md Rule 20.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxTimeout: { type: 'number', default: 10000 },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const maxTimeout = typeof options.maxTimeout === 'number' ? options.maxTimeout : 10000;

    // Playwright web-first (auto-waiting) assertions + locator.waitFor.
    // Excludes navigation waits (waitForResponse/URL/Selector/LoadState) which
    // legitimately use short polls and are governed by other rules.
    const TARGET_METHODS = new Set([
      'toBeVisible',
      'toBeHidden',
      'toBeChecked',
      'toBeEnabled',
      'toBeDisabled',
      'toBeEditable',
      'toBeFocused',
      'toBeEmpty',
      'toBeAttached',
      'toBeInViewport',
      'toContainText',
      'toHaveText',
      'toHaveValue',
      'toHaveValues',
      'toHaveAttribute',
      'toHaveClass',
      'toHaveCount',
      'toHaveCSS',
      'toHaveId',
      'toHaveJSProperty',
      'toHaveTitle',
      'toHaveURL',
      'toBeOK',
      'waitFor',
    ]);

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier'
        ) {
          return;
        }
        const methodName = node.callee.property.name;
        if (!TARGET_METHODS.has(methodName)) return;

        // Look for an options object argument carrying a numeric `timeout` literal.
        for (const arg of node.arguments) {
          if (arg.type !== 'ObjectExpression') continue;
          for (const prop of arg.properties) {
            if (
              prop.type !== 'Property' ||
              prop.computed ||
              prop.value.type !== 'Literal' ||
              typeof prop.value.value !== 'number'
            ) {
              continue;
            }
            const keyName =
              prop.key.type === 'Identifier'
                ? prop.key.name
                : prop.key.type === 'Literal'
                  ? prop.key.value
                  : null;
            if (keyName !== 'timeout') continue;
            if (prop.value.value <= maxTimeout) {
              context.report({
                node: prop,
                messageId: 'subdefaultTimeout',
                data: { value: prop.value.value, method: methodName },
              });
            }
          }
        }
      },
    };
  },
};
