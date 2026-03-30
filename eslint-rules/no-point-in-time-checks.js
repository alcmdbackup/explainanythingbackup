/**
 * ESLint rule to flag point-in-time DOM checks in E2E tests.
 *
 * Point-in-time methods (page.textContent, page.isVisible, locator.innerText, etc.)
 * execute once and return immediately — they race with React hydration and streaming.
 * Use Playwright auto-waiting assertions instead (expect(locator).toBeVisible(), etc.).
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer auto-waiting assertions over point-in-time DOM checks in E2E tests',
      category: 'Best Practices',
    },
    messages: {
      noPointInTime:
        'Avoid {{method}}() for assertions — it runs once and can race with hydration/streaming. Use {{suggestion}} instead. See testing_overview.md Rule 4.',
    },
    schema: [],
  },
  create(context) {
    // Map: method name → suggested auto-waiting replacement
    const pointInTimeMethods = {
      textContent: 'expect(locator).toContainText()',
      innerText: 'expect(locator).toContainText()',
      isVisible: 'expect(locator).toBeVisible()',
      isHidden: 'expect(locator).toBeHidden()',
      isChecked: 'expect(locator).toBeChecked()',
      isDisabled: 'expect(locator).toBeDisabled()',
      isEnabled: 'expect(locator).toBeEnabled()',
      isEditable: 'expect(locator).toBeEditable()',
      getAttribute: 'expect(locator).toHaveAttribute()',
      inputValue: 'expect(locator).toHaveValue()',
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier'
        ) {
          return;
        }

        const methodName = node.callee.property.name;
        const suggestion = pointInTimeMethods[methodName];
        if (!suggestion) return;

        // Skip if the call is inside an expect() — that's already an assertion context
        // e.g. expect(await page.textContent('body')).toContain(...)
        // Walk up the AST to check if we're inside expect()
        let parent = node.parent;
        while (parent) {
          if (
            parent.type === 'CallExpression' &&
            parent.callee.type === 'Identifier' &&
            parent.callee.name === 'expect'
          ) {
            // Inside expect() — this is the "wrapping in expect" pattern.
            // Still flag it — the whole pattern should be replaced with auto-waiting.
            break;
          }
          // If used as argument to safeWaitFor, safeIsVisible, etc. — allow
          if (
            parent.type === 'CallExpression' &&
            parent.callee.type === 'Identifier' &&
            /^safe[A-Z]/.test(parent.callee.name)
          ) {
            return;
          }
          parent = parent.parent;
        }

        // Skip if result is assigned and used for control flow (if/conditional),
        // not for assertion — these are legitimate "check and branch" patterns.
        // Only flag when the result flows into expect() or is the sole statement.
        const parentNode = node.parent;

        // Allow: const x = await page.isVisible(...) when used in if/ternary
        if (parentNode.type === 'AwaitExpression') {
          const awaitParent = parentNode.parent;
          if (
            awaitParent.type === 'VariableDeclarator' ||
            awaitParent.type === 'AssignmentExpression'
          ) {
            // Check if the variable is used in an if-statement or ternary
            // We can't easily do full data-flow analysis, so allow variable assignments
            // and only flag direct usage in expect() or as standalone statements
            return;
          }
        }

        // Allow: standalone call not used for assertion (e.g., logging)
        if (
          parentNode.type === 'ExpressionStatement' ||
          (parentNode.type === 'AwaitExpression' &&
            parentNode.parent.type === 'ExpressionStatement')
        ) {
          // Standalone call — likely used for side effects or logging, allow
          return;
        }

        context.report({
          node,
          messageId: 'noPointInTime',
          data: {
            method: methodName,
            suggestion,
          },
        });
      },
    };
  },
};
