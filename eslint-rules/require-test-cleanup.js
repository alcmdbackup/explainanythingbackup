/**
 * ESLint rule requiring afterAll cleanup in E2E specs that import database tools.
 *
 * If a spec file imports from '@supabase/supabase-js', 'test-data-factory',
 * or 'evolution-test-helpers', it must contain a test.afterAll or adminTest.afterAll block.
 *
 * Known limitation: specs creating entities purely via UI form submissions (no DB imports)
 * won't be caught by this rule.
 *
 * Opt-out: // eslint-disable-next-line flakiness/require-test-cleanup
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'E2E specs importing database tools must have afterAll cleanup',
      category: 'Best Practices',
    },
    messages: {
      missingCleanup:
        'This spec imports database tools ({{ source }}) but has no afterAll cleanup block. Add test.afterAll or adminTest.afterAll to clean up test data.',
    },
    schema: [],
  },
  create(context) {
    const DB_IMPORT_PATTERNS = [
      '@supabase/supabase-js',
      'test-data-factory',
      'evolution-test-helpers',
    ];

    let dbImportNode = null;
    let dbImportSource = '';
    let hasAfterAll = false;

    return {
      ImportDeclaration(node) {
        if (dbImportNode) return; // Already found one
        const source = node.source.value;
        if (typeof source === 'string') {
          for (const pattern of DB_IMPORT_PATTERNS) {
            if (source.includes(pattern)) {
              dbImportNode = node;
              dbImportSource = pattern;
              return;
            }
          }
        }
      },

      // Detect *.afterAll(...) calls
      CallExpression(node) {
        if (hasAfterAll) return;
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'afterAll'
        ) {
          hasAfterAll = true;
        }
      },

      'Program:exit'() {
        if (dbImportNode && !hasAfterAll) {
          context.report({
            node: dbImportNode,
            messageId: 'missingCleanup',
            data: { source: dbImportSource },
          });
        }
      },
    };
  },
};
