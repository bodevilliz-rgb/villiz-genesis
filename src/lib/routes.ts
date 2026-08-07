/**
 * Single source of truth for every URL in the platform. Route strings never
 * appear inline in components — renaming a segment is then a one-file change.
 */
export const routes = {
  login: "/login",
  authCallback: "/auth/callback",
  dashboard: "/dashboard",
  publishing: "/publishing",
  review: "/review",
  reviewWorkspace: (id: string) => `/review/${id}`,
  reviewCompare: (id: string) => `/review/${id}/compare`,
  settings: "/settings",
  settingsPublishing: "/settings/publishing",
  organisations: {
    index: "/organisations",
    new: "/organisations/new",
    detail: (id: string) => `/organisations/${id}`,
    settings: (id: string) => `/organisations/${id}/settings`,
    team: (id: string) => `/organisations/${id}/team`,
    membrain: {
      index: (id: string) => `/organisations/${id}/membrain`,
      new: (id: string) => `/organisations/${id}/membrain/new`,
      entry: (id: string, entryId: string) => `/organisations/${id}/membrain/${entryId}`,
      edit: (id: string, entryId: string) => `/organisations/${id}/membrain/${entryId}/edit`,
      history: (id: string, entryId: string) => `/organisations/${id}/membrain/${entryId}/history`,
    },
    content: {
      index: (id: string) => `/organisations/${id}/content`,
      new: (id: string) => `/organisations/${id}/content/new`,
      draft: (id: string, draftId: string) => `/organisations/${id}/content/${draftId}`,
      history: (id: string, draftId: string) => `/organisations/${id}/content/${draftId}/history`,
    },
    campaigns: {
      index: (id: string) => `/organisations/${id}/campaigns`,
      new: (id: string) => `/organisations/${id}/campaigns/new`,
      detail: (id: string, campaignId: string) => `/organisations/${id}/campaigns/${campaignId}`,
      edit: (id: string, campaignId: string) => `/organisations/${id}/campaigns/${campaignId}/edit`,
    },
    media: {
      index: (id: string) => `/organisations/${id}/media`,
      detail: (id: string, assetId: string) => `/organisations/${id}/media/${assetId}`,
    },
    publishing: {
      index: (id: string) => `/organisations/${id}/publishing`,
      job: (id: string, jobId: string) => `/organisations/${id}/publishing/${jobId}`,
    },
    reports: {
      index: (id: string) => `/organisations/${id}/reports`,
    },
  },
} as const;

/**
 * Sprint 8.0 — extracted from src/app/auth/callback/route.ts so its
 * same-origin-only redirect guard is directly unit-testable. Behaviour is
 * unchanged: a `next` query param is only honoured if it's a same-origin
 * relative path (starts with exactly one `/`) — anything else (a full URL,
 * a protocol-relative `//evil.com`, or nothing at all) falls back to the
 * dashboard, so the magic-link callback can never be turned into an open
 * redirect.
 */
export function resolveSafeNextPath(requested: string | null): string {
  return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : routes.dashboard;
}
