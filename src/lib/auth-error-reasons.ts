/**
 * Copy shown on /auth/error, keyed by the `?reason=` value the callback and
 * accept flows attach when they cannot complete sign-in. Kept in one module so
 * the wording in tests and UI can never drift apart.
 *
 * Copy rules: sign-in links are verifiably single-use, but server-side validity
 * windows differ per flow, so copy must never promise a specific lifetime.
 */
export const AUTH_ERROR_REASONS = {
  expired:
    "Sign-in links are single-use and expire quickly. Open the newest sign-in email and tap its link once.",
  missing_code: "That link is incomplete. Open the most recent email and use the button inside it.",
} as const;

export type AuthErrorReason = keyof typeof AUTH_ERROR_REASONS;

const FALLBACK_REASON =
  "Something interrupted the sign-in. Request a new link and try again.";

export function describeAuthErrorReason(reason: string | null | undefined): string {
  if (reason && reason in AUTH_ERROR_REASONS) {
    return AUTH_ERROR_REASONS[reason as AuthErrorReason];
  }

  return FALLBACK_REASON;
}