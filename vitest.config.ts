import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    // tsconfig.json sets jsx: "preserve" (Next does its own transform), so
    // Vite/esbuild can't infer the mode from tsconfig and falls back to the
    // classic runtime (React.createElement without importing React). Force
    // the automatic runtime so component tests don't need a manual React
    // import in every .tsx test file.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jest-dom.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // A targeted alias, not a global `resolve.conditions: ["react-server"]`
      // override — that approach was tried and reverted because it also
      // makes React itself resolve to its restricted react-server build
      // (React ships genuinely different code behind that condition, one
      // that disallows client hooks), breaking any test that renders a
      // "use client" component. Aliasing only this one package sidesteps
      // that entirely.
      "server-only": fileURLToPath(new URL("./tests/setup/server-only-stub.ts", import.meta.url)),
    },
  },
});
