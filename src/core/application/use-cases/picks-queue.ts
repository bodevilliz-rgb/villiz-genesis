import { createHash } from "node:crypto";

import type { MembrainContextItem } from "@/core/domain/entities/membrain";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";

const PLATFORM_HOSTS: Record<PublishingPlatform, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"],
  facebook: ["facebook.com", "www.facebook.com", "fb.watch"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
};

const PLATFORM_NAMES: Record<PublishingPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
};

function hasPlatformPostPath(platform: PublishingPlatform, url: URL): boolean {
  if (platform === "instagram") return /^\/p\/[^/]+\/?$/.test(url.pathname);
  if (platform === "tiktok") return /^\/@[^/]+\/(?:photo|video)\/[^/]+\/?$/.test(url.pathname);
  return true;
}

function cleanSentence(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const bounded = compact.slice(0, 4600).trim();
  return /[.!?]$/.test(bounded) ? bounded : `${bounded}.`;
}

export function buildPickCaptionOptions(input: {
  itemLabel: string;
  context: readonly MembrainContextItem[];
}): [string, string, string] {
  const label = cleanSentence(input.itemLabel.replace(/\.[^.]+$/, ""));
  const fragments = input.context
    .flatMap((item) => [item.summary, item.body])
    .filter((value): value is string => Boolean(value?.trim()))
    .map(cleanSentence);
  const first = fragments[0] || label || "A new story from the team.";
  const second = fragments[1] || first;
  const third = fragments[2] || fragments[0] || first;

  const candidates = [
    `${label || "A new update"} ${first}`,
    `${second} ${label ? `Discover ${label.toLowerCase()}.` : "Discover more."}`,
    `${third} ${second === third ? "What stands out to you?" : "Tell us what stands out to you."}`,
  ].map(cleanSentence);

  const unique: string[] = [];
  for (const candidate of candidates) {
    let value = candidate;
    while (unique.includes(value)) value = cleanSentence(`${value} Share your view`);
    unique.push(value.slice(0, 5000));
  }
  return unique as [string, string, string];
}

export async function verifyNativePostUrl(
  platform: PublishingPlatform,
  rawUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ publicUrl: string; receiptId: string; verifiedAt: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid public post URL.");
  }
  const assertPlatformUrl = (candidate: URL) => {
    if (
      candidate.protocol !== "https:" ||
      !PLATFORM_HOSTS[platform].includes(candidate.hostname.toLowerCase()) ||
      !hasPlatformPostPath(platform, candidate)
    ) {
      throw new Error(`Enter a public ${PLATFORM_NAMES[platform]} post URL.`);
    }
  };
  assertPlatformUrl(url);

  let response: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetcher(url.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": "Genesis-Native-Post-Verifier/1.0" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("The platform URL could not be read live. Check that the post is public and try again.");
    url = new URL(location, url);
    assertPlatformUrl(url);
  }
  if (!response?.ok) throw new Error("The platform URL could not be read live. Check that the post is public and try again.");
  const publicUrl = url.toString();
  const receiptId = `native:${createHash("sha256").update(`${platform}|${publicUrl}`).digest("hex").slice(0, 24)}`;
  return { publicUrl, receiptId, verifiedAt: new Date().toISOString() };
}

export function isMervicAlertEligible(
  organisationName: string,
  twilioEnabled: boolean,
  simulated: boolean,
): boolean {
  return twilioEnabled && !simulated && /\bmervic\b/i.test(organisationName);
}
