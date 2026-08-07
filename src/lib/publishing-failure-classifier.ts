/**
 * Maps raw errorCode strings from PublishingAttempt into human-readable
 * categories with recommended actions. Pure function — no I/O, no imports.
 *
 * Error codes come from two sources:
 *   • BlotatoPublisherBase: blotato_no_connected_account, blotato_status_timeout, blotato_publish_failed
 *   • simulatePublish:      mock_simulated_failure
 *   • InfrastructureError:  any remaining codes are treated as infrastructure/unknown
 */

export type FailureCategory =
  | "no_account"
  | "timeout"
  | "platform_rejection"
  | "rate_limit"
  | "auth_error"
  | "network_error"
  | "simulation"
  | "unknown";

export interface FailureClassification {
  category: FailureCategory;
  label: string;
  description: string;
  recommendedAction: string;
  severity: "low" | "medium" | "high";
}

const CLASSIFICATIONS: Record<FailureCategory, Omit<FailureClassification, "category">> = {
  no_account: {
    label: "No account connected",
    description: "No social account is linked for this platform.",
    recommendedAction: "Go to Publishing Settings and connect an account, then retry.",
    severity: "high",
  },
  timeout: {
    label: "Status timeout",
    description: "Blotato accepted the post but did not confirm a final status in time.",
    recommendedAction: "Check the Blotato dashboard for the submission's outcome, then retry if it failed.",
    severity: "medium",
  },
  platform_rejection: {
    label: "Platform rejected post",
    description: "The social platform refused the post after it was submitted.",
    recommendedAction: "Review the error message for content or media requirements, then edit the draft and retry.",
    severity: "high",
  },
  rate_limit: {
    label: "Rate limited",
    description: "The platform or API rate limit was hit.",
    recommendedAction: "Wait before retrying. Consider spacing out scheduled posts.",
    severity: "medium",
  },
  auth_error: {
    label: "Authentication error",
    description: "The connected account's credentials are invalid or expired.",
    recommendedAction: "Reconnect the account in Publishing Settings and retry.",
    severity: "high",
  },
  network_error: {
    label: "Network error",
    description: "A transient network failure interrupted the publish request.",
    recommendedAction: "Retry the job. If this persists, check platform status pages.",
    severity: "low",
  },
  simulation: {
    label: "Simulated failure",
    description: "This failure was triggered by a dev simulation mode override.",
    recommendedAction: "Clear the dev simulation override on the draft and retry.",
    severity: "low",
  },
  unknown: {
    label: "Unknown error",
    description: "An unexpected error occurred.",
    recommendedAction: "Check the full error message below, then retry or contact support.",
    severity: "medium",
  },
};

export function classifyPublishingFailure(errorCode: string | null): FailureClassification {
  const category = resolveCategory(errorCode ?? "");
  return { category, ...CLASSIFICATIONS[category] };
}

function resolveCategory(errorCode: string): FailureCategory {
  if (errorCode === "blotato_no_connected_account") return "no_account";
  if (errorCode === "blotato_status_timeout") return "timeout";
  if (errorCode === "blotato_publish_failed") return "platform_rejection";
  if (errorCode === "mock_simulated_failure") return "simulation";
  if (/rate.?limit|429/i.test(errorCode)) return "rate_limit";
  if (/auth|401|403|forbidden|unauthorized/i.test(errorCode)) return "auth_error";
  if (/network|timeout|econnreset|etimedout|socket|fetch/i.test(errorCode)) return "network_error";
  return "unknown";
}
