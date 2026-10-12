import { isMervicAlertEligible } from "@/core/application/use-cases/picks-queue";

export interface MervicPublishAlertInput {
  organisationName: string;
  simulated: boolean;
  publicUrl: string;
  enqueue: () => Promise<void>;
  enabled?: boolean;
}

export type MervicPublishAlertResult = "queued" | "ineligible" | "failed";

/**
 * Enqueues the external alert-script contract. Genesis intentionally contains
 * no Twilio implementation or credentials; the automation consumer owns that
 * boundary and invokes call_alerts.py.
 */
export async function queueMervicPublishAlert(input: MervicPublishAlertInput): Promise<MervicPublishAlertResult> {
  const enabled = input.enabled ?? process.env.TWILIO_ENABLED === "true";
  if (!isMervicAlertEligible(input.organisationName, enabled, input.simulated)) return "ineligible";
  try {
    await input.enqueue();
    return "queued";
  } catch {
    return "failed";
  }
}
