// Load shims and polyfills BEFORE any modules are imported
// This file runs via setupFiles in Jest config

// OpenAI SDK requires Web Fetch API types in Node environment
// Must be loaded before any imports from 'openai' package
require('openai/shims/node');

// structuredClone polyfill for the jsdom test environment (Node has it natively,
// jsdom does not expose it). ESLint 9's RuleTester uses structuredClone when
// normalizing rule options, so the custom eslint-rules/*.test.js suites (now run
// under Jest — see jest.config testMatch) need it. v8 serialize/deserialize is a
// faithful structured clone (Dates/Maps/Sets/undefined), so this only ADDS the
// standard global when missing — it cannot change behavior for tests that already
// pass without it.
if (typeof globalThis.structuredClone !== 'function') {
  const v8 = require('node:v8');
  globalThis.structuredClone = (value) => v8.deserialize(v8.serialize(value));
}

// B115: sentinel so jest.setup.js can assert it ran first. If a future refactor
// reorders `setupFiles` and accidentally drops this file (or runs it after
// jest.setup.js), the assertion in jest.setup.js will fail loudly instead of
// producing confusing "fetch is not defined" errors deep in a test run.
global.__JEST_SHIMS_LOADED__ = true;