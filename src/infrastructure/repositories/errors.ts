import { classifyPollError } from "@/core/domain/entities/infrastructure-error";
import { ConflictError, ForbiddenError, InfrastructureError, LimitExceededError, NotFoundError } from "@/core/domain/errors";

interface PostgrestLike {
  code?: string;
  status?: number;
  statusCode?: number | string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Translates Postgres/PostgREST failures into domain errors.
 *
 * Every repository funnels errors through here so that a database constraint —
 * the real guarantee — produces the same user-facing message as an application
 * check, and so raw SQL text is never leaked to the browser.
 */
export function translateError(error: PostgrestLike | null, context: string): never {
  const code = error?.code ?? "";
  const message = error?.message ?? "Unknown database error";

  switch (code) {
    case "23505":
      throw new ConflictError("That record already exists.");
    case "23503":
      throw new ConflictError("A related record is missing or still in use.");
    case "23514":
      throw new ConflictError("Those values are outside the allowed range.");
    case "42501":
      throw new ForbiddenError("You do not have permission to do that.");
    case "PGRST116":
      throw new NotFoundError(context);
    case "P0001":
      throw new LimitExceededError(message);
    default:
      throw Object.assign(new InfrastructureError(`${context} failed. ${message}`), {
        infrastructureCategory: classifyPollError(error),
      });
  }
}

export function unwrap<T>(result: { data: T | null; error: PostgrestLike | null; status?: number }, context: string): T {
  if (result.error) translateError({ ...result.error, status: result.status ?? result.error.status }, context);
  if (result.data === null) throw new NotFoundError(context);
  return result.data;
}
