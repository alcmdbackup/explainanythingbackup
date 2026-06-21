/**
 * Tests for the require-llm-call-source ESLint rule.
 *
 * Run with: node eslint-rules/require-llm-call-source.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('./require-llm-call-source');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

const IMPORT = `import { callLLM, callLLMModel, callOpenAIModel } from '@/lib/services/llms';\n`;

ruleTester.run('require-llm-call-source', rule, {
  valid: [
    // Registry member access (with the real import)
    `${IMPORT}callLLM(prompt, CALL_SOURCES.evaluateTags, userid, model, false, null);`,
    // Factory calls
    `${IMPORT}callLLM(prompt, evolutionSource(label), userid, model, false, null);`,
    `${IMPORT}callLLM(prompt, testSource('test_source'), userid, model, false, null);`,
    // A CallSource-typed variable / const (brand vouches via tsc)
    `${IMPORT}callLLM(prompt, PROMPT_EDITOR_CALL_SOURCE, userid, model, false, null);`,
    // LOCAL callLLM (NOT imported from the llms module) with a literal — must NOT be flagged
    `function callLLM(a, b) { return b; }\ncallLLM(prompt, 'anything');`,
    "import { callLLM } from './oneshotGenerator';\ncallLLM(systemPrompt, `<source>${x}</source>`);",
    // Unrelated calls are ignored
    `withLogging(fn, 'enhanceContentWithInlineLinks');`,
    `someOther('p', 'literal');`,
    // Member-expression caller checked, but registry member is fine
    `svc.callLLM(prompt, CALL_SOURCES.streamChatApi, userid, model, false, null);`,
  ],
  invalid: [
    {
      code: `${IMPORT}callLLM(prompt, 'evaluateTags', userid, model, false, null);`,
      errors: [{ messageId: 'noLiteral' }],
    },
    {
      code: IMPORT + 'callLLM(prompt, `evolution_${label}`, userid, model, false, null);',
      errors: [{ messageId: 'noLiteral' }],
    },
    {
      code: `${IMPORT}callOpenAIModel(prompt, 'foo' as CallSource, userid, model, false, null);`,
      errors: [{ messageId: 'noCast' }],
    },
    {
      code: `${IMPORT}callLLMModel(prompt, 'bar', userid, model, false, null);`,
      errors: [{ messageId: 'noLiteral' }],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('require-llm-call-source: all RuleTester cases passed');
