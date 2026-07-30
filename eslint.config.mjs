import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Flat config, on the ESLint CLI.
 *
 * `next lint` is deprecated in Next 15.5 and removed in 16; it also drops into
 * an interactive setup prompt when no config exists, which makes it unusable in
 * CI. The lint script now calls ESLint directly.
 */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**", "scripts/**"],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // Unused variables are a bug signal, but an underscore prefix is a
      // deliberate statement that a binding exists only to be skipped.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // The domain layer models absent values explicitly; `any` would erase
      // exactly the guarantees this codebase is built on.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // The isolation guarantee is architectural: core must never learn about
    // Supabase, Next.js or React. A lint rule states that in a way that fails
    // the build rather than relying on reviewer memory.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*", "next", "next/*", "react", "react/*", "server-only"],
              message:
                "core/ must stay free of infrastructure. Define a port in core/application/ports and implement it in infrastructure/.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
