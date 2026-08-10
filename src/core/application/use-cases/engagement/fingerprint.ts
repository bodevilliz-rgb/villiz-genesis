import { createHash } from "node:crypto";
import { composePublishedText } from "@/core/application/use-cases/content/hashtags";

/** Exact, non-reversible fingerprint of the caption + ordered hashtag payload sent to a platform. */
export function engagementPayloadFingerprint(caption: string, hashtags: string[]): string {
  return createHash("sha256").update(composePublishedText(caption, hashtags), "utf8").digest("hex");
}

