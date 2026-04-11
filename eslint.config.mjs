import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import local ESLint rules for test flakiness prevention
const require = createRequire(import.meta.url);
const flakinessRules = require("./eslint-rules/index.js");
const designSystemRules = require("./eslint-rules/design-system.js");
const promisePlugin = require("eslint-plugin-promise");

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
  // Flakiness prevention rules for E2E spec files
  {
    files: ["**/*.spec.ts", "**/*.spec.tsx"],
    plugins: {
      flakiness: flakinessRules,
    },
    rules: {
      "flakiness/max-test-timeout": "error",
      "flakiness/no-test-skip": "error",
      "flakiness/require-test-cleanup": "error",
      "flakiness/no-point-in-time-checks": "error",
      "flakiness/no-point-in-time-pom-helpers": "error",
      "flakiness/no-nth-child-cell-selector": "error",
      "flakiness/no-duplicate-describe-name": "error",
      "flakiness/require-serial-with-beforeall": "error",
      "flakiness/warn-slow-with-retries": "warn",
    },
  },
  // Admin-only rule: require resetFilters() in specs that seed [TEST] data.
  // Scoped to 09-admin/ because that's where filterTestContent default lives.
  {
    files: ["src/__tests__/e2e/specs/09-admin/**/*.spec.ts"],
    plugins: {
      flakiness: flakinessRules,
    },
    rules: {
      "flakiness/require-reset-filters": "error",
    },
  },
  // Flakiness prevention for all E2E files (specs + helpers)
  {
    files: ["**/e2e/**/*.ts", "**/e2e/**/*.tsx"],
    plugins: {
      flakiness: flakinessRules,
    },
    rules: {
      "flakiness/no-wait-for-timeout": "error",
      "flakiness/no-silent-catch": "error",
      "flakiness/no-networkidle": "error",
      "flakiness/no-hardcoded-tmpdir": "error",
      "flakiness/no-hardcoded-base-url": "error",
      "flakiness/require-hydration-wait": "error",
    },
  },
  // Column label uniqueness for UI table definitions
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
    plugins: {
      flakiness: flakinessRules,
    },
    rules: {
      "flakiness/no-duplicate-column-labels": "error",
    },
  },
  // Promise handling rules to catch silent error swallowing
  {
    plugins: {
      promise: promisePlugin,
    },
    rules: {
      // Prevent empty catch blocks - catches `catch {}` but not `.catch(() => {})`
      "no-empty": ["error", { allowEmptyCatch: false }],
      // Enforce proper promise error handling (migration complete — zero violations)
      "promise/catch-or-return": "error",
    },
  },
  // Design system enforcement for all source files
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
    plugins: {
      "design-system": designSystemRules,
    },
    rules: {
      "design-system/no-hardcoded-colors": "error",
      "design-system/no-arbitrary-text-sizes": "error",
      "design-system/prefer-design-system-fonts": "error",
      "design-system/prefer-warm-shadows": "error",
      // New rules for colors and radius
      "design-system/no-tailwind-color-classes": "warn",
      "design-system/prefer-design-radius": "warn",
      // New rules for typography consistency
      "design-system/enforce-heading-typography": "warn",
      "design-system/enforce-prose-font": "error",
      "design-system/no-inline-typography": "error",
    },
  },
  // Enforce typed Supabase clients to prevent schema drift
  {
    files: ["scripts/**/*.ts", "src/__tests__/**/*.ts", "evolution/scripts/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.name='createClient']:not([typeArguments])",
        message: "Use createClient<Database>() instead of untyped createClient(). Import Database from '@/lib/database.types'.",
      }],
    },
  },
  // Boundary enforcement: evolution/ must not import app-layer modules from src/
  {
    files: ["evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/components/*", "@/app/*", "@/actions/*"],
            message: "Evolution code must not import app-layer modules. Use @/lib/* for shared infra only.",
          },
        ],
      }],
    },
  },
  // Strict TypeScript enforcement for evolution production code
  {
    files: ["evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "evolution/src/testing/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "never",
      }],
      "@typescript-eslint/explicit-function-return-type": ["warn", {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
    },
  },
  // Exceptions for files with intentional hardcoding
  {
    files: [
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/app/settings/SettingsContent.tsx",
      "src/app/(debug)/**/*.ts",
      "src/app/(debug)/**/*.tsx",
      "src/app/admin/costs/page.tsx",
      "**/*.test.tsx",
    ],
    rules: {
      "design-system/no-hardcoded-colors": "off",
      "design-system/no-arbitrary-text-sizes": "off",
      "design-system/prefer-warm-shadows": "off",
      "design-system/no-tailwind-color-classes": "off",
      "design-system/prefer-design-radius": "off",
      "design-system/enforce-heading-typography": "off",
      "design-system/enforce-prose-font": "off",
      "design-system/no-inline-typography": "off",
    },
  },
];

export default eslintConfig;
