"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[genesis] render error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-danger">Error</p>
      <h1 className="text-2xl font-semibold tracking-tight">This screen failed to load</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Nothing was saved. Try again — if it keeps happening, send engineering the reference below.
      </p>
      {error.digest ? (
        <code className="rounded-md border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
          {error.digest}
        </code>
      ) : null}
      <button
        onClick={reset}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Try again
      </button>
    </main>
  );
}
