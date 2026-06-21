/**
 * ESLint rule: the 2nd argument (call_source) to callLLM / callLLMModel / callOpenAIModel
 * must come from the typed registry/factories, never a brand-defeating pattern.
 *
 * The branded `CallSource` type (Layer 0) already guarantees that any variable, member
 * access (CALL_SOURCES.*), or factory call (evolutionSource(...), testSource(...)) passed
 * here is type-correct. This rule (Layer 1) closes the escape hatches the brand can't catch:
 * string literals, template literals, and `as CallSource` / `as unknown as CallSource` casts.
 * It also covers JS callers where the type isn't enforced.
 *
 * See docs/planning/build_llm_spending_tab_in_admin_dash_20260620/ and
 * docs/docs_overall/testing_overview.md (ESLint Enforcement Summary).
 */
const LLM_CALLERS = new Set(['callLLM', 'callLLMModel', 'callOpenAIModel']);

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the call_source argument to callLLM to come from CALL_SOURCES or a CallSource factory, not a string/template literal or `as` cast',
      category: 'Best Practices',
    },
    messages: {
      noLiteral:
        'Pass a CallSource from CALL_SOURCES.* or a factory (evolutionSource(...) / testSource(...) in tests), not a string/template literal. See the mandatory attribution system.',
      noCast:
        'Do not use `as CallSource` to bypass attribution. Add the source to CALL_SOURCES (src/lib/services/llmCallSource.ts) or use a factory.',
    },
    schema: [],
  },
  create(context) {
    // Only flag calls to the REAL callLLM imported from the llms service module. Local
    // helper functions named `callLLM` (e.g. evolution/scripts/*) take a different
    // signature and must not be flagged.
    const importedRealCallers = new Set();

    function isLlmsModule(source) {
      return /(^|\/)llms$/.test(source) || /\/services\/llms$/.test(source);
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !isLlmsModule(node.source.value)) return;
        for (const spec of node.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            spec.imported.type === 'Identifier' &&
            LLM_CALLERS.has(spec.imported.name)
          ) {
            importedRealCallers.add(spec.local.name);
          }
        }
      },
      CallExpression(node) {
        // Member-expression callers (svc.callLLM) and identifiers only if they resolve to
        // the imported real callLLM. This avoids false positives on local same-named helpers.
        let callerName = null;
        if (node.callee.type === 'Identifier') {
          callerName = importedRealCallers.has(node.callee.name) ? node.callee.name : null;
        } else if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          LLM_CALLERS.has(node.callee.property.name)
        ) {
          callerName = node.callee.property.name;
        }
        if (!callerName) return;

        const arg = node.arguments[1];
        if (!arg) return;
        if (arg.type === 'Literal' || arg.type === 'TemplateLiteral') {
          context.report({ node: arg, messageId: 'noLiteral' });
        } else if (arg.type === 'TSAsExpression') {
          context.report({ node: arg, messageId: 'noCast' });
        }
      },
    };
  },
};

// calleeName retained for reference; import-aware logic above supersedes it.
void calleeName;
