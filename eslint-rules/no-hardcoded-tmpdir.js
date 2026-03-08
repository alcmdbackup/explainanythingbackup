/**
 * ESLint rule to disallow hardcoded /tmp/ paths in test files.
 * Use os.tmpdir() with worker-specific subdirectories to prevent race conditions in parallel tests.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded /tmp/ paths - use os.tmpdir() with worker-specific subdirectories',
      category: 'Best Practices',
    },
    messages: {
      noHardcodedTmpdir:
        'Avoid hardcoded /tmp/ paths. Use os.tmpdir() with a worker-specific subdirectory to prevent race conditions in parallel test execution.',
    },
    schema: [],
  },
  create(context) {
    const workerPatterns = /worker|WORKER|workerIndex|TEST_PARALLEL_INDEX/;

    function checkStringValue(node, value) {
      if (typeof value !== 'string') return;
      if (!value.includes('/tmp/')) return;
      if (workerPatterns.test(value)) return;
      context.report({ node, messageId: 'noHardcodedTmpdir' });
    }

    return {
      Literal(node) {
        checkStringValue(node, node.value);
      },
      TemplateLiteral(node) {
        // Check quasis (static parts) for /tmp/
        const raw = node.quasis.map((q) => q.value.raw).join('');
        if (!raw.includes('/tmp/')) return;

        // Check if any expression references worker-related identifiers
        const source = context.getSourceCode().getText(node);
        if (workerPatterns.test(source)) return;

        context.report({ node, messageId: 'noHardcodedTmpdir' });
      },
    };
  },
};
