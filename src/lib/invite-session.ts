export type InviteSession = { accessToken: string; refreshToken: string };

/** Parse only the fields needed to establish an invited user's session. */
export function parseInviteSessionHash(hash: string): InviteSession | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const type = params.get("type");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if ((type !== "invite" && type !== "magiclink") || !accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}
