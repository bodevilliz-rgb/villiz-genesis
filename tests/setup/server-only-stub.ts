// Test-only stand-in for the "server-only" package. Aliased in vitest.config.ts
// so that infrastructure modules guarded with `import "server-only"` (e.g. the
// mock publisher adapters) load fine under Vitest without pulling in a
// `resolve.conditions` override that would also affect React's own
// resolution (React ships a genuinely different, hook-restricted build under
// the "react-server" condition — applying that condition project-wide broke
// component tests that use client hooks). This stub does nothing, exactly
// like the real package's own "react-server" export variant does.
export {};
