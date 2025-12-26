import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import local ESLint rules for test flakiness prevention
const require = createRequire(import.meta.url);
const flakinessRules = require("./eslint-rules/index.js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      ".turbo/**",
      "dist/**",
      "coverage/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__mocks__/**", "**/testing/**", "jest.*.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["*.js", "*.mjs", "*.cjs", "jest.*.js", "tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Flakiness prevention rules for E2E tests
  {
    files: ["**/*.spec.ts", "**/*.spec.tsx"],
    plugins: {
      flakiness: flakinessRules,
    },
    rules: {
      "flakiness/no-wait-for-timeout": "error",
      "flakiness/max-test-timeout": "warn",
    },
  },
];

export default eslintConfig;
