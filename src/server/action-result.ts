import { isDomainError } from "@/core/domain/errors";

export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
  /** Populated on success where the caller needs the new record's id. */
  resourceId?: string;
}

export const idleState: ActionState = { status: "idle", message: "" };

export function successState(message: string, resourceId?: string): ActionState {
  return { status: "success", message, resourceId };
}

/**
 * Converts any thrown error into a state a form can render. Unknown errors are
 * logged server-side and reported generically — internal detail never reaches
 * the browser.
 */
export function errorState(error: unknown): ActionState {
  if (isDomainError(error)) {
    return { status: "error", message: error.message, fieldErrors: error.details };
  }

  console.error("[genesis] unhandled action error", error);
  return { status: "error", message: "Something went wrong. Try again, and tell engineering if it repeats." };
}

/** Reads a single text value from FormData, normalising empty strings to undefined. */
export function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function textOrEmpty(formData: FormData, key: string): string {
  return text(formData, key) ?? "";
}

/** Reads a comma-separated list (used by the tag input). */
export function list(formData: FormData, key: string): string[] {
  const value = formData.get(key);
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
}

/** Reads every value posted under one field name — a real multi-value field (checkboxes), not a CSV string. */
export function getAll(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string");
}
