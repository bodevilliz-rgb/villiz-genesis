import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  createRecommendation: vi.fn(),
  applyRecommendation: vi.fn(),
  activeAccounts: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/core/application/use-cases/content", () => ({
  createDraft: mocks.createDraft,
  createGenerationRequest: vi.fn(), updateDraft: vi.fn(), scheduleDraft: vi.fn(),
  publishDraft: vi.fn(), archiveDraft: vi.fn(), duplicateDraft: vi.fn(),
}));
vi.mock("@/server/action-result", () => ({
  successState: (message: string, resourceId: string) => ({ status: "success", message, resourceId }),
  errorState: (error: unknown) => ({ status: "error", message: error instanceof Error ? error.message : String(error) }),
  textOrEmpty: (formData: FormData, key: string) => String(formData.get(key) ?? ""),
}));
vi.mock("@/server/container", () => ({
  requireContext: vi.fn(async () => ({
    actor: { id: "actor-1" },
    engagement: { create: mocks.createRecommendation, applyRecommendation: mocks.applyRecommendation },
    blotatoAccounts: { findActiveForOrganisationAndPlatform: mocks.activeAccounts },
    media: { listAssets: mocks.listAssets },
    content: {}, membrain: {}, organisations: {},
  })),
}));

import { createDraftAction } from "@/server/actions/content";

const ORG = "11111111-1111-4111-a111-111111111111";
const DRAFT = "22222222-2222-4222-a222-222222222222";
const ASSET = "33333333-3333-4333-a333-333333333333";

function attribution(destinationAccountId: string | null = "account-a") {
  return {
    caption: "A grounded caption.", platform: "instagram", destinationAccountId,
    mediaAssetIds: [ASSET], commercialIntent: "convert", commercialIntentSource: "recommended",
    culturalVoiceLevel: "neutral", suggestedHashtags: ["Coventry", "Grounded"],
    visibilityPlan: {
      goal: "convert", goalRationale: "Configured enquiry action.", contentJob: "CONVERSION",
      distributionGate: "pass", distributionReadinessScore: 100, distributionBlockers: [],
      targetLocalities: ["Coventry"], platformStrategy: "Use visual proof for local service discovery.",
      discoveryRoles: ["local", "service"],
      targetAudience: "Configured audience", mediaObservation: "Visible product image.",
      contentPillar: "Useful expertise", contentPillarRationale: "Selected from MemBrain.",
      contentFormat: "single_image", formatRationale: "One image is selected.", attentionMechanism: "Relevance",
      hookStrategy: "question", actualHook: "Could this solve your next challenge?",
      discoveryStrategy: "Use verified category language.", searchableLanguage: ["verified category"],
      ctaStrategy: "Invite an enquiry.", measurementPlan: "Measure explicit enquiries separately from engagement.",
      supportingDistributionActions: ["Reshare while current."], publishingWindow: "Unknown.",
      publishingWindowEvidenceState: "INSUFFICIENT_ACCOUNT_EVIDENCE", visibilityEvidenceLevel: "FOUNDATION_AND_MARKET",
      verticalIntelligenceAvailable: true, evidenceSources: ["foundation:professional-services-v1", "market-pattern:pattern-a"],
      confidence: 60, foundationVersion: "professional-services-v1", rationale: "Labelled hypothesis.",
    },
  };
}

function form(payload = attribution()) {
  const data = new FormData();
  data.set("organisationId", ORG); data.set("title", "Grounded draft"); data.set("body", "A grounded caption.");
  data.set("contentType", "social_post"); data.set("hashtags", JSON.stringify(["Coventry", "Grounded"]));
  data.set("awoAttribution", JSON.stringify(payload));
  return data;
}

describe("New Draft → existing engagement attribution path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDraft.mockResolvedValue({ id: DRAFT, organisationId: ORG, version: 1, body: "A grounded caption.", hashtags: ["Coventry", "Grounded"] });
    mocks.activeAccounts.mockResolvedValue([{ id: "account-a" }]);
    mocks.listAssets.mockResolvedValue([{ id: ASSET }]);
    mocks.createRecommendation.mockResolvedValue({ id: "recommendation-1" });
    mocks.applyRecommendation.mockResolvedValue({ feedbackId: "feedback-1" });
  });

  it("persists content, destination and evidence attribution in the existing immutable recommendation and feedback records", async () => {
    expect(await createDraftAction({ status: "idle", message: "" }, form())).toMatchObject({ status: "success", resourceId: DRAFT });
    expect(mocks.createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: ORG, draftId: DRAFT, draftVersion: 1, platform: "instagram", objectiveType: "enquiries",
      strategyMetadata: expect.objectContaining({ commercialIntent: "convert", commercialIntentSource: "recommended", contentJob: "CONVERSION", contentPillar: "Useful expertise", hookFamily: "question", destinationAccountId: "account-a", destinationPlatform: "instagram", marketPatternIds: ["pattern-a"], foundationVersion: "professional-services-v1", visibilityEvidenceLevel: "FOUNDATION_AND_MARKET" }),
      evidence: [{ sourceType: "media_asset", sourceId: ASSET, title: "Selected draft media" }],
    }));
    expect(mocks.applyRecommendation).toHaveBeenCalledWith(expect.objectContaining({ draftId: DRAFT, recommendationId: "recommendation-1", variant: "recommended", captionSnapshot: "A grounded caption.", hashtagSnapshot: ["Coventry", "Grounded"] }));
  });

  it("preserves no-destination as an honest attributed state", async () => {
    await createDraftAction({ status: "idle", message: "" }, form(attribution(null)));
    expect(mocks.activeAccounts).not.toHaveBeenCalled();
    expect(mocks.createRecommendation).toHaveBeenCalledWith(expect.objectContaining({ strategyMetadata: expect.objectContaining({ destinationAccountId: null }) }));
  });

  it("blocks persistence when the operator did not accept the complete supported discovery set", async () => {
    const data = form();
    data.set("hashtags", JSON.stringify([]));
    mocks.createDraft.mockResolvedValue({ id: DRAFT, organisationId: ORG, version: 1, body: "A grounded caption.", hashtags: [] });

    expect(await createDraftAction({ status: "idle", message: "" }, data)).toMatchObject({ status: "error" });
    expect(mocks.createRecommendation).not.toHaveBeenCalled();
    expect(mocks.applyRecommendation).not.toHaveBeenCalled();
  });

  it("rejects an inactive or cross-organisation destination instead of attributing it", async () => {
    mocks.activeAccounts.mockResolvedValue([{ id: "other-account" }]);
    const result = await createDraftAction({ status: "idle", message: "" }, form());
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.createRecommendation).not.toHaveBeenCalled();
  });
});
