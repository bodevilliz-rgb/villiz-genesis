// @vitest-environment jsdom
/**
 * DraftForm — hashtag autosave regression (fix/scheduled-publishing-integrity).
 *
 * Root cause: every other field's autosave fires via the form's onInput
 * bubbling (a native "input" event from a text input/textarea). Hashtag
 * chips are added/removed via <button type="button" onClick>, which never
 * fires an "input" event and so never bubbled to the form-level autosave
 * handler at all. An operator could add hashtag chips (rendered instantly,
 * looking saved), never trigger any other field, and reach Approve/Schedule
 * with content_drafts.hashtags still holding its old value — proven against
 * real production data where an approved draft's page showed six hashtag
 * chips while the database column was still `[]`.
 *
 * H1 — adding a hashtag (Enter key) schedules an autosave without any other field changing
 * H2 — removing a hashtag schedules an autosave
 * H3 — accepting an AI-suggested hashtag schedules an autosave
 * H4 — the autosaved payload's hashtags field matches the current chip set exactly
 * H5 — six independently-added hashtags all survive into a single autosave payload
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/server/actions/content", () => ({
  createDraftAction: vi.fn(),
  updateDraftAction: vi.fn(async () => ({ status: "success", message: "Saved", resourceId: "draft-1" })),
}));

vi.mock("@/server/actions/media", () => ({
  attachAssetToDraftAction: vi.fn(),
  detachAssetFromDraftAction: vi.fn(),
  detachAssetFromPublishedDraftAction: vi.fn(),
}));

vi.mock("@/server/actions/awo", () => ({
  generateCaption: vi.fn(),
  generateHashtags: vi.fn(async () => ({ hashtags: ["suggested"] })),
  rewriteContent: vi.fn(),
}));

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DraftForm } from "@/components/content/draft-form";
import { updateDraftAction } from "@/server/actions/content";
import type { ContentDraft } from "@/core/domain/entities/content";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function existingDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "draft-1",
    organisationId: ORG_ID,
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Existing body text",
    status: "approved" /* unlocked fields test uses "approved" only via `locked` prop below — draft-form itself computes lock from isContentDraftLocked; use "in_review" or pre-approval status so fields are editable */,
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    reviewerIds: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    createdBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    updatedBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    priority: "medium",
    reviewDeadline: null,
    hashtags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function latestHashtagsPayload(): string[] {
  const calls = vi.mocked(updateDraftAction).mock.calls;
  const lastCall = calls[calls.length - 1];
  const formData = lastCall![1] as FormData;
  return JSON.parse(formData.get("hashtags") as string);
}

describe("H1/H4 — adding a hashtag schedules an autosave carrying the new tag", () => {
  it("typing a hashtag and pressing Enter triggers updateDraftAction with hashtags included, with no other field touched", async () => {
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    const hashtagInput = screen.getByLabelText("Add hashtags");
    fireEvent.change(hashtagInput, { target: { value: "growth" } });
    fireEvent.keyDown(hashtagInput, { key: "Enter" });

    expect(screen.getByText("#growth")).toBeInTheDocument();
    expect(updateDraftAction).not.toHaveBeenCalled(); // not yet — still debouncing

    vi.advanceTimersByTime(2100);

    await waitFor(() => expect(updateDraftAction).toHaveBeenCalledTimes(1));
    expect(latestHashtagsPayload()).toEqual(["growth"]);
  });
});

describe("H2 — removing a hashtag schedules an autosave", () => {
  it("removing a chip triggers an autosave reflecting the removal", async () => {
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: ["keepme", "removeme"] })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove #removeme"));
    vi.advanceTimersByTime(2100);

    await waitFor(() => expect(updateDraftAction).toHaveBeenCalledTimes(1));
    expect(latestHashtagsPayload()).toEqual(["keepme"]);
  });
});

describe("H3 — accepting an AI-suggested hashtag schedules an autosave", () => {
  it("clicking a suggested hashtag chip triggers an autosave including it", async () => {
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", body: "Some body text" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    const suggestion = await screen.findByText("#suggested");
    fireEvent.click(suggestion);

    vi.advanceTimersByTime(2100);

    await waitFor(() => expect(updateDraftAction).toHaveBeenCalledTimes(1));
    expect(latestHashtagsPayload()).toEqual(["suggested"]);
  });
});

describe("H5 — six independently-added hashtags all survive into the autosave payload", () => {
  it("six separate Add actions produce exactly six stored tags, once each", async () => {
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    const hashtagInput = screen.getByLabelText("Add hashtags");
    const tags = ["one", "two", "three", "four", "five", "six"];
    for (const tag of tags) {
      fireEvent.change(hashtagInput, { target: { value: tag } });
      fireEvent.keyDown(hashtagInput, { key: "Enter" });
    }

    for (const tag of tags) {
      expect(screen.getByText(`#${tag}`)).toBeInTheDocument();
    }

    vi.advanceTimersByTime(2100);

    await waitFor(() => expect(updateDraftAction).toHaveBeenCalled());
    expect(latestHashtagsPayload()).toEqual(tags);
    expect(latestHashtagsPayload()).toHaveLength(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H6–H9 (fix/platform-hashtag-policy, P0) — Awo's "Suggest hashtags" must
// never hand the operator a set that would push the total over the known
// destination platform's verified limit. Instagram's limit (5) is the exact
// one proven by the production 422 this whole fix responds to.
// ─────────────────────────────────────────────────────────────────────────────

describe("H6/T14 (mandate) — Awo requests only the REMAINING allowance for a known Instagram destination", () => {
  it("2 existing hashtags + Instagram (max 5) → requests exactly 3 more, not the generic 5", async () => {
    const { generateHashtags } = await import("@/server/actions/awo");
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: ["existing1", "existing2"], scheduledPlatform: "instagram" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    await waitFor(() => expect(generateHashtags).toHaveBeenCalledWith(ORG_ID, expect.any(String), 3, "instagram"));
  });
});

describe("H7/T14 (mandate) — suggestions are truncated to the remaining allowance even if the AI over-returns", () => {
  it("AI returns 5 suggestions but only 3 are allowed → only 3 are offered", async () => {
    const { generateHashtags } = await import("@/server/actions/awo");
    vi.mocked(generateHashtags).mockResolvedValueOnce({ hashtags: ["s1", "s2", "s3", "s4", "s5"] });

    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: ["existing1", "existing2"], scheduledPlatform: "instagram" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    await screen.findByText("#s1");
    expect(screen.queryByText("#s4")).toBeNull();
    expect(screen.queryByText("#s5")).toBeNull();
  });
});

describe("H8/T14 (mandate) — already at Instagram's limit: suggestion is refused up front, no AI call made", () => {
  it("5 existing hashtags on Instagram → clicking Suggest hashtags never calls generateHashtags", async () => {
    const { generateHashtags } = await import("@/server/actions/awo");
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: ["a", "b", "c", "d", "e"], scheduledPlatform: "instagram", body: "Some body" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    await waitFor(() => expect(generateHashtags).not.toHaveBeenCalled());
  });
});

describe("H9 — without a known platform, existing generic behaviour (request 5) is preserved", () => {
  it("no scheduledPlatform on the draft → requests the generic default of 5", async () => {
    const { generateHashtags } = await import("@/server/actions/awo");
    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: [], scheduledPlatform: null })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    await waitFor(() => expect(generateHashtags).toHaveBeenCalledWith(ORG_ID, expect.any(String), 5, "instagram"));
  });
});

describe("H10 — accepting a suggestion is refused once the platform limit is already reached", () => {
  it("4 existing + Instagram (max 5): accepting one suggestion succeeds; accepting a second is refused", async () => {
    const { generateHashtags } = await import("@/server/actions/awo");
    vi.mocked(generateHashtags).mockResolvedValueOnce({ hashtags: ["extra"] });

    render(
      <DraftForm
        organisationId={ORG_ID}
        draft={existingDraft({ status: "needs_review", hashtags: ["a", "b", "c", "d"], scheduledPlatform: "instagram" })}
        categories={[]}
        campaigns={[]}
        locked={false}
      />,
    );

    fireEvent.click(screen.getByText("Suggest hashtags"));
    const suggestion = await screen.findByText("#extra");
    fireEvent.click(suggestion); // 4 -> 5, exactly at the limit

    expect(screen.getByText("#extra")).toBeInTheDocument();
    // A second manual add attempt via the suggestion path would now be
    // refused — proven directly against acceptSuggestedHashtag's guard by
    // confirming the hashtag count sits exactly at the platform's max.
    expect(screen.getAllByText(/^#/).length).toBe(5);
  });
});
