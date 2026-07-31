export interface PublishingPayload {
  title: string;
  body: string;
  mediaUrls?: string[];
  scheduledAt?: string;
}

export interface PublishingResult {
  success: boolean;
  externalPostId?: string;
  errorMessage?: string;
}

/**
 * Transport-only provider interface for publishing channels.
 * Business logic remains in the domain, not inside implementations.
 */
export interface PublishingProvider {
  platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "youtube";
  publish(payload: PublishingPayload): Promise<PublishingResult>;
}
