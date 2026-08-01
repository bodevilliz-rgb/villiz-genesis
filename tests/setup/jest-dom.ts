import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't enable jest-style global test hooks by default (no
// `test.globals` in vitest.config.ts), so @testing-library/react's own
// auto-cleanup detection — which only looks for a global `afterEach` — never
// fires. Without this, a jsdom test file's DOM nodes leak into every
// subsequent `it()` in the same file, causing `getByText`/`queryByText` to
// see stale elements from earlier tests. Guarded for the plain `environment:
// "node"` test files (the majority of this suite), where there is no
// document to clean up at all.
afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
