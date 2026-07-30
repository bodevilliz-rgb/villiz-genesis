/**
 * Single source of truth for every URL in the platform. Route strings never
 * appear inline in components — renaming a segment is then a one-file change.
 */
export const routes = {
  login: "/login",
  authCallback: "/auth/callback",
  dashboard: "/dashboard",
  review: "/review",
  settings: "/settings",
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
  },
} as const;
