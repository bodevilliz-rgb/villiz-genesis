/**
 * GoTrue deliberately burns one-time codes after a single successful exchange,
 * so re-tapping an already-consumed magic link surfaces a stale-code error even
 * though the visitor may already hold a valid session from the earlier tap.
 *
 * This classifier groups that already-used/expired error class so the callback
 * route can check for an existing session and retry the visitor into the app
 * instead of showing a dead-end error page. Anything that is NOT clearly a
 * consumed/expired one-time code is deliberately not matched — a genuine
 * auth-server failure must keep landing on /auth/error (fail closed).
 */
export type StaleTokenSignal = {
  code?: string | null;
  message?: string | null;
};

const STALE_TOKEN_PATTERNS: RegExp[] = [
  /otp[-_]?expired/i,
  /one-?time token/i,
  /flow[-_ ]?state/i,
  /token (?:has )?expired/i,
];

export function isStaleTokenError(error: StaleTokenSignal | null | undefined): boolean {
  if (!error) {
    return false;
  }

  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";

  return STALE_TOKEN_PATTERNS.some((pattern) => pattern.test(code) || pattern.test(message));
}