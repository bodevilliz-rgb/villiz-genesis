const TERMINAL_PROVIDER_ERROR_TOKENS = [
  "prepayment credits are depleted",
  "insufficient quota",
  "billing hard limit",
  "incorrect api key",
  "invalid api key",
  "api key not valid",
  "authentication failed",
  "unauthorized",
];

const RETRYABLE_PROVIDER_ERROR_TOKENS = [
  "high demand",
  "temporarily",
  "try again later",
  "rate limit",
  "429",
  "503",
  "502",
  "504",
  "timeout",
  "timed out",
  "no object generated",
  "response did not match schema",
  "ai_apicallerror",
];

export function isRetryableProviderError(error: unknown): boolean {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).toLowerCase();
  if (TERMINAL_PROVIDER_ERROR_TOKENS.some((token) => message.includes(token))) return false;
  return RETRYABLE_PROVIDER_ERROR_TOKENS.some((token) => message.includes(token));
}
