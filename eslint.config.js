import js from "@eslint/js";
import tsPlugin from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// Strict, type-aware config applied to all code: api/, drizzle/, shared/,
// scripts/, and the full frontend (app/src/**). All pages and components
// are wired to real tRPC and pass strict lint.
const sharedRules = {
  "no-console": ["error", { allow: ["warn", "error"] }],
  "no-debugger": "error",
  "no-duplicate-imports": "error",
  "prefer-const": "error",

  // Auth provider boundary: only the auth adapter folders may import @clerk/*.
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@clerk/*"],
          message:
            "Import from '@/auth' (frontend) or 'api/lib/auth-provider' (backend) instead. The auth provider is an adapter confined to those two folders so we can swap providers later.",
        },
      ],
    },
  ],

  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "@typescript-eslint/explicit-module-boundary-types": "error",

  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",

  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/no-unnecessary-condition": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
  "@typescript-eslint/no-confusing-void-expression": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/prefer-nullish-coalescing": "error",
  "@typescript-eslint/prefer-optional-chain": "error",

  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error",

  "@typescript-eslint/strict-boolean-expressions": [
    "error",
    {
      allowString: false,
      allowNumber: false,
      allowNullableObject: true,
      allowNullableBoolean: false,
      allowNullableString: false,
      allowNullableNumber: false,
      allowAny: false,
    },
  ],
};

export default [
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".aws-sam/",
      "drizzle/meta/",
      // Root tooling config (not part of the typed lint program).
      "*.config.js",
      "*.config.mjs",
      "vite.config.ts",
    ],
  },
  js.configs.recommended,
  // TypeScript (.ts) — backend, shared, scripts, frontend non-component code.
  {
    files: [
      "app/src/**/*.ts",
      "api/**/*.ts",
      "shared/**/*.ts",
      "drizzle/**/*.ts",
      "scripts/**/*.ts",
      "drizzle.config.ts",
      "vitest.config.ts",
    ],
    languageOptions: {
      parser: tsPlugin.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: ["./tsconfig.api.json", "./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tsPlugin.plugin,
    },
    rules: {
      ...sharedRules,
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 8],
      "max-depth": ["error", 6],
      complexity: ["error", 15],
    },
  },
  // Authored React components (.tsx) — relaxed function limits for JSX.
  {
    files: ["app/src/**/*.tsx"],
    languageOptions: {
      parser: tsPlugin.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: ["./tsconfig.api.json", "./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: {
      "@typescript-eslint": tsPlugin.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...sharedRules,
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 8],
      "max-depth": ["error", 6],
      complexity: ["error", 25],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      "no-undef": "off",
    },
  },
  // Auth adapter folders: direct @clerk/* imports allowed (this is the adapter).
  {
    files: ["app/src/auth/**/*.{ts,tsx}", "api/lib/auth-provider/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
