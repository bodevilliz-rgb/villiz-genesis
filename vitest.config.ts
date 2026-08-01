import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // Matches Next.js's own server bundler condition, so infrastructure
    // modules guarded with `import "server-only"` (e.g. the mock publisher
    // adapters) resolve to the real, empty server build here too instead of
    // the package's client-bundle build, which throws on import.
    conditions: ["react-server"],
  },
  ssr: {
    // Vitest runs everything through its SSR pipeline; `resolve.conditions`
    // above only covers the client graph, so it has to be repeated here for
    // node_modules packages (like `server-only`) to see it too.
    resolve: { conditions: ["react-server"] },
  },
});
