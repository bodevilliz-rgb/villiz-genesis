import { expect, it, vi } from "vitest";
import { BlotatoPublisherBase } from "@/infrastructure/publishers/blotato/blotato-publisher-base";
class Publisher extends BlotatoPublisherBase { readonly platform = "facebook" as const; }
function harness() {
  const client = { uploadMedia: vi.fn().mockResolvedValue({ url: "https://cdn.test/image" }), publishPost: vi.fn().mockResolvedValue({ postSubmissionId: "accepted" }), getPostStatus: vi.fn().mockResolvedValue({ status: "published" }) };
  const publisher = new Publisher({ blotatoAccounts: { findActiveForOrganisationAndPlatform: async () => [{ id: "account", active: true }] } as never, blotatoClient: client as never, livePublishingEnabled: true });
  const input = { organisationId: "org", assetUrls: ["https://storage.test/image"], body: "caption", onBeforeSubmission: vi.fn() };
  return { client, publisher, input };
}
it("awaits durable submission barrier and refuses POST if it cannot be saved", async () => {
  const h = harness(); h.input.onBeforeSubmission.mockRejectedValue(new Error("barrier unavailable"));
  await expect(h.publisher.publish(h.input as never)).rejects.toThrow("barrier unavailable");
  expect(h.client.publishPost).not.toHaveBeenCalled();
});
it("retains the accepted submission ID when status checking fails", async () => {
  const h = harness(); h.client.getPostStatus.mockRejectedValue({ status: 503 });
  expect(await h.publisher.publish(h.input as never)).toMatchObject({ success: "pending", providerSubmissionId: "accepted", metadata: { confirmationError: { status: 503 } } });
  expect(h.client.publishPost).toHaveBeenCalledOnce();
});
it.each([{ code: "exceed_egress_quota" }, { status: 429 }, { status: 503 }])("stops media upload immediately on service pressure and preserves classification: %j", async error => {
  const h = harness(); h.input.assetUrls.push("https://storage.test/second"); h.client.uploadMedia.mockRejectedValue(error);
  const result = await h.publisher.publish(h.input as never);
  expect(result).toMatchObject({ success: false, metadata: { infrastructureError: error } });
  expect(h.client.uploadMedia).toHaveBeenCalledOnce(); expect(h.client.publishPost).not.toHaveBeenCalled();
});
