/**
 * Sprint 7.1 — Section 3: safe, opt-in Blotato connectivity check.
 *
 * Only ever runs when RELIABILITY_CHECK_BLOTATO_CONNECTION=true is set —
 * normal execution (including CI) never requires a real Blotato API key.
 * Uses only the same read-only calls cloud-check.ts already relies on
 * (GET /users/me/accounts via HttpBlotatoClient.listAccounts) — never
 * publishPost, never any mutation, never a live post.
 */
import type { ReliabilityCheck } from "./types";

function redactApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export const blotatoConnectivityCheck: ReliabilityCheck = {
  name: "Blotato connectivity (external, opt-in)",
  classification: "EXTERNAL",
  async run() {
    if (process.env.RELIABILITY_CHECK_BLOTATO_CONNECTION !== "true") {
      return { skip: "RELIABILITY_CHECK_BLOTATO_CONNECTION is not 'true' — external Blotato connectivity was not requested for this run." };
    }

    const apiKey = process.env.BLOTATO_API_KEY;
    if (!apiKey) {
      return { skip: "RELIABILITY_CHECK_BLOTATO_CONNECTION=true but BLOTATO_API_KEY is not set." };
    }

    const { HttpBlotatoClient } = await import("@/infrastructure/blotato/http-blotato-client");
    const client = new HttpBlotatoClient(apiKey);

    // Read-only: lists connected accounts. Never calls publishPost.
    const accounts = await client.listAccounts();

    return { detail: { apiKeyRedacted: redactApiKey(apiKey), connectedAccountCount: accounts.length } };
  },
};
