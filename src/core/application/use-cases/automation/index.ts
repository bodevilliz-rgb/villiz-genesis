import { z } from "zod";
import type { AutomationRepository } from "@/core/application/ports/automation-port";

const consumerSchema = z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._:-]+$/);
const claimSchema = z.object({
  consumer: consumerSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  leaseSeconds: z.coerce.number().int().min(10).max(600).default(60),
});
const ackSchema = z.object({
  eventId: z.string().uuid(),
  consumer: consumerSchema,
  leaseToken: z.string().uuid(),
});

export function getAutomationStatus(repository: AutomationRepository) {
  return repository.status();
}

export function claimAutomationEvents(repository: AutomationRepository, input: unknown) {
  return repository.claim(claimSchema.parse(input));
}

export function acknowledgeAutomationEvent(repository: AutomationRepository, input: unknown) {
  return repository.acknowledge(ackSchema.parse(input));
}
