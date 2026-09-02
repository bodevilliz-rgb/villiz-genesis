import { describe, expect, it, vi } from "vitest";
import { createGenerationRequest } from "@/core/application/use-cases/content";
import type { ContentDraft, ContentGenerationRequest } from "@/core/domain/entities/content";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  fullName: "Owner",
  avatarUrl: null,
  jobTitle: null,
  role: "owner" as const,
  isActive: true,
  isPlatformAdmin: true,
};

const draft = {
  id: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
} as ContentDraft;

const request = {
  id: "00000000-0000-4000-8000-000000000004",
  draftId: draft.id,
  organisationId: draft.organisationId,
} as ContentGenerationRequest;

describe("createGenerationRequest campaign scheduling regression", () => {
  it("bounds the MemBrain retrieval query while preserving the full valid generation request", async () => {
    const retrieveContext = vi.fn().mockResolvedValue([]);
    const createRequest = vi.fn().mockResolvedValue(request);
    const deps = {
      actor,
      content: {
        findDraft: vi.fn().mockResolvedValue(draft),
        createGenerationRequest: createRequest,
      },
      membrain: { retrieveContext },
      organisations: {
        findById: vi.fn().mockResolvedValue({ id: draft.organisationId, name: "Villiz" }),
      },
    } as unknown as Parameters<typeof createGenerationRequest>[0];

    const brief = [
      "Prepare Week 1 of the campaign “Campaign” for instagram.",
      `Campaign objective: ${"o".repeat(300)}.`,
      `Primary CTA: ${"c".repeat(120)}.`,
      "Use the organisation MemBrain and current Market Intelligence evidence when Awo generates the platform-specific caption, hook, CTA and discovery strategy.",
      "The post must pass the Audience Distribution Gate before approval or scheduling.",
    ].join(" ");
    const targetAudience = "People responsible for social content operations";
    const tone = "Use the approved brand voice and platform-appropriate delivery.";

    await expect(createGenerationRequest(deps, {
      organisationId: draft.organisationId,
      draftId: draft.id,
      brief,
      targetAudience,
      tone,
    })).resolves.toBe(request);

    const retrievalInput = retrieveContext.mock.calls[0]?.[0];
    expect(retrievalInput?.query).toHaveLength(500);
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      brief,
      targetAudience,
      tone,
    }));
  });

  it("does not split a Unicode surrogate pair at the retrieval limit", async () => {
    const retrieveContext = vi.fn().mockResolvedValue([]);
    const deps = {
      actor,
      content: {
        findDraft: vi.fn().mockResolvedValue(draft),
        createGenerationRequest: vi.fn().mockResolvedValue(request),
      },
      membrain: { retrieveContext },
      organisations: {
        findById: vi.fn().mockResolvedValue({ id: draft.organisationId, name: "Villiz" }),
      },
    } as unknown as Parameters<typeof createGenerationRequest>[0];

    await createGenerationRequest(deps, {
      organisationId: draft.organisationId,
      draftId: draft.id,
      brief: `${"a".repeat(499)}😀tail`,
    });

    const retrievalInput = retrieveContext.mock.calls[0]?.[0];
    expect(retrievalInput?.query).toBe("a".repeat(499));
    expect(() => encodeURI(retrievalInput?.query ?? "")).not.toThrow();
  });
});
