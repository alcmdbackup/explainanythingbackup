// Load shims and polyfills BEFORE any modules are imported
// This file runs via setupFiles in Jest config

// OpenAI SDK requires Web Fetch API types in Node environment
// Must be loaded before any imports from 'openai' package
require('openai/shims/node');