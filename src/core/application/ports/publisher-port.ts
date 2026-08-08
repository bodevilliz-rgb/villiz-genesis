import type { PublisherResult, PublishingPlatform } from "@/core/domain/entities/publishing";

export interface PublishInput {
  organisationId: string;
  draftId: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  platform: PublishingPlatform;
  title: string;
  body: string;
  assetUrls: string[];
  /**
   * Already resolved to "always_succeed" by the caller whenever
   * NODE_ENV=production (see infrastructure/publishers/simulation-mode.ts) —
   * a mock adapter never needs to re-check the environment itself, it only
   * ever sees an effective, already-safe value.
   */
  devSimulationMode: "always_succeed" | "fail_next_attempt" | "always_fail";
  /**
   * Destination lock set at scheduling time (Sprint 10B). When multiple active
   * accounts are connected for the same platform, the publisher uses this ID to
   * route to the correct account rather than failing with blotato_ambiguous_account.
   * Null or absent when only one account is connected (no disambiguation needed).
   */
  resolvedAccountId?: string | null;
}

/**
 * Provider-neutral publishing abstraction. The application/domain layers
 * depend on this interface only — never on a concrete adapter. Today every
 * implementation is simulated (see infrastructure/publishers/mock); a real
 * LinkedIn/Facebook/Instagram/X integration is a drop-in replacement that
 * satisfies this same contract, requiring no change above this line.
 */
export interface PublisherPort {
  readonly platform: PublishingPlatform;
  publish(input: PublishInput): Promise<PublisherResult>;
}
