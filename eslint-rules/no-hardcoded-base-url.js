/**
 * ESLint rule to disallow hardcoded localhost URLs in E2E test files.
 * POMs and fixtures should use page.goto('/relative-path') so Playwright resolves
 * against the configured baseURL, not construct absolute URLs with fallback ports.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded localhost URLs in E2E files - use relative paths with Playwright baseURL',
      category: 'Best Practices',
    },
    messages: {
      noHardcodedBaseUrl:
        "Don't construct URLs with 'http://localhost:{{port}}'. Use page.goto('/relative-path') so Playwright resolves against its configured baseURL. The dev server port is dynamic and hardcoded fallbacks will be wrong.",
    },
    schema: [],
  },
  create(context) {
    // Match http://localhost:NNNN where NNNN is a port number
    const localhostPortPattern = /http:\/\/localhost:\d{4}/;

    // Allow in comments and in playwright.config.ts (which defines the fallback)
    const filename = context.getFilename();
    if (filename.includes('playwright.config')) return {};

    function checkStringValue(node, value) {
      if (typeof value !== 'string') return;
      if (!localhostPortPattern.test(value)) return;

      // Extract the port for the error message
      const match = value.match(/localhost:(\d{4})/);
      const port = match ? match[1] : '????';

      context.report({ node, messageId: 'noHardcodedBaseUrl', data: { port } });
    }

    return {
      Literal(node) {
        checkStringValue(node, node.value);
      },
      TemplateLiteral(node) {
        const raw = node.quasis.map((q) => q.value.raw).join('');
        checkStringValue(node, raw);
      },
    };
  },
};
