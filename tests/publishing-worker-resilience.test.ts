import { describe, expect, it, vi } from "vitest";
import { classifyPollError, createBackoffController, nextBackoffMs, pollOnce } from "../scripts/publishing-worker-core";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";

/**
 * Sprint 7.1 — regression coverage for the cloud pilot's observed
 * `TypeError: fetch failed` terminating the worker. Root cause: pollOnce's
 * for(;;) loop caught errors from processJob (an already-claimed job
 * failing to publish) but not from claimNextPublishingJob itself — and
 * pollOnce runs as `void pollOnce(deps)` under setInterval, so an unhandled
 * rejection there killed the whole process (Node's default behaviour for
 * unhandled promise rejections).
 *
 * These four tests map directly to the four properties the fix is required
 * to prove:
 *   1/2. one transient claim failure does not kill the worker, and
 *        subsequent polling succeeds — tested together against the real
 *        exported pollOnce.
 *   3. repeated failures use bounded backoff — tested against nextBackoffMs
 *      in isolation, deliberately independent of pollOnce's shared
 *      module-level backoff state (which persists across calls within this
 *      file and isn't reset between tests).
 *   4. shutdown interrupts waiting cleanly — tested against
 *      createBackoffController in isolation.
 */

describe("classifyPollError", () => {
  it("categorises a Supabase 'fetch failed' TypeError as network", () => {
    expect(classifyPollError(new TypeError("fetch failed"))).toBe("network");
  });

  it("categorises common transient network error codes as network", () => {
    expect(classifyPollError(new Error("connect ECONNRESET"))).toBe("network");
    expect(classifyPollError(new Error("getaddrinfo ENOTFOUND xyz.supabase.co"))).toBe("network");
    expect(classifyPollError(new Error("connect ETIMEDOUT"))).toBe("network");
  });

  it("categorises anything else as unknown, rather than guessing", () => {
    expect(classifyPollError(new Error("invalid input syntax for type uuid"))).toBe("unknown");
    expect(classifyPollError("a bare string throw")).toBe("unknown");
  });
});

describe("nextBackoffMs — bounded exponential backoff, isolated from pollOnce's module state", () => {
  it("starts at the base delay after the first failure", () => {
    expect(nextBackoffMs(0, 1000, 30_000)).toBe(1000);
  });

  it("doubles on each subsequent failure", () => {
    let backoff = 0;
    backoff = nextBackoffMs(backoff, 1000, 30_000);
    expect(backoff).toBe(1000);
    backoff = nextBackoffMs(backoff, 1000, 30_000);
    expect(backoff).toBe(2000);
    backoff = nextBackoffMs(backoff, 1000, 30_000);
    expect(backoff).toBe(4000);
  });

  it("never exceeds the configured maximum, however many failures occur in a row", () => {
    let backoff = 0;
    for (let i = 0; i < 20; i++) {
      backoff = nextBackoffMs(backoff, 1000, 30_000);
    }
    expect(backoff).toBe(30_000);
  });
});

describe("createBackoffController — cancellable wait, isolated from pollOnce", () => {
  it("resolves on its own after the requested delay", async () => {
    vi.useFakeTimers();
    try {
      const controller = createBackoffController();
      let resolved = false;
      const promise = controller.wait(5000).then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately when cancelled, without waiting for the full delay — this is what lets shutdown interrupt a backing-off worker instantly", async () => {
    vi.useFakeTimers();
    try {
      const controller = createBackoffController();
      let resolved = false;
      const promise = controller.wait(30_000).then(() => {
        resolved = true;
      });

      // Advance almost none of the delay, then cancel — a real shutdown
      // signal can arrive at any point during a long backoff wait.
      await vi.advanceTimersByTimeAsync(10);
      expect(resolved).toBe(false);

      controller.cancel();
      await promise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel() is a safe no-op when nothing is currently waiting", () => {
    const controller = createBackoffController();
    expect(() => controller.cancel()).not.toThrow();
  });
});

describe("pollOnce — a transient claim failure does not kill the worker, and the next claim attempt still runs", () => {
  it("catches the error, backs off, retries the claim, and resolves normally once a poll succeeds (finding no due job)", async () => {
    vi.useFakeTimers();
    try {
      const claimNextJob = vi
        .fn<PublishingRepository["claimNextJob"]>()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(null);

      const fakeDeps = {
        publishing: { claimNextJob } as unknown as PublishingRepository,
        content: {},
        audits: {},
        notifications: {},
        blotatoAccounts: {},
        blotatoClient: {},
        blotatoLivePublishingEnabled: false,
        media: {},
        storage: {},
      };

      const pending = pollOnce(fakeDeps as never);

      // Let the first (failing) claim's microtasks settle, then advance past
      // whatever backoff pollOnce scheduled before it retries.
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(pending).resolves.toBeUndefined();
      expect(claimNextJob).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
