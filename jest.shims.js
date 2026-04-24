// Load shims and polyfills BEFORE any modules are imported
// This file runs via setupFiles in Jest config

// OpenAI SDK requires Web Fetch API types in Node environment
// Must be loaded before any imports from 'openai' package
require('openai/shims/node');

// B115: sentinel so jest.setup.js can assert it ran first. If a future refactor
// reorders `setupFiles` and accidentally drops this file (or runs it after
// jest.setup.js), the assertion in jest.setup.js will fail loudly instead of
// producing confusing "fetch is not defined" errors deep in a test run.
global.__JEST_SHIMS_LOADED__ = true;