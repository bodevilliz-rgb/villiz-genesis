export function classifyPollError(error: unknown): "quota" | "rate_limit" | "service" | "network" | "unknown" {
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const category = fields.infrastructureCategory;
  if (category === "quota" || category === "rate_limit" || category === "service" || category === "network") return category;
  const message = [fields.code, fields.errorCode, fields.message, fields.errorMessage, typeof error === "string" ? error : ""].join(" ");
  const status = Number(fields.status ?? fields.statusCode);
  if (/exceed_egress_quota|quota|restrict/i.test(message)) return "quota";
  if (status === 429 || /\b429\b|rate.?limit/i.test(message)) return "rate_limit";
  if ((status >= 500 && status <= 599) || /\b5\d\d\b/.test(message)) return "service";
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i.test(message) ? "network" : "unknown";
}

/** Retain only bounded scalar diagnostics, never response bodies or request objects. */
export function infrastructureErrorDetails(error: unknown): Record<string, string | number> {
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : { message: String(error) };
  const details: Record<string, string | number> = {};
  for (const key of ["code", "status", "statusCode", "message", "infrastructureCategory"]) {
    const value = fields[key];
    if (typeof value === "string") details[key] = value.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 512);
    else if (typeof value === "number") details[key] = value;
  }
  return details;
}
