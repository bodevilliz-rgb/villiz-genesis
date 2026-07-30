/**
 * Domain errors. The presentation layer maps these to user-facing messages and
 * HTTP semantics; nothing below this layer knows what an HTTP status code is.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string, readonly details?: Record<string, string[]>) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code = "validation_error";
  readonly httpStatus = 422;
}

export class NotFoundError extends DomainError {
  readonly code = "not_found";
  readonly httpStatus = 404;

  constructor(resource: string) {
    super(`${resource} could not be found.`);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = "forbidden";
  readonly httpStatus = 403;

  constructor(message = "You do not have access to this organisation.") {
    super(message);
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = "unauthenticated";
  readonly httpStatus = 401;

  constructor(message = "Sign in to continue.") {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = "conflict";
  readonly httpStatus = 409;
}

export class LimitExceededError extends DomainError {
  readonly code = "limit_exceeded";
  readonly httpStatus = 429;
}

export class InfrastructureError extends DomainError {
  readonly code = "infrastructure_error";
  readonly httpStatus = 500;
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
