// @vitest-environment jsdom

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/media", () => ({
  updateMediaMetadataAction: vi.fn(), requestMediaUploadAction: vi.fn(), registerMediaReplacementAction: vi.fn(),
  archiveMediaAction: vi.fn(), deleteMediaAction: vi.fn(), retryMediaCleanupAction: vi.fn(),
}));
vi.mock("@/infrastructure/supabase/browser-client", () => ({ createBrowserSupabaseClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetDetailForm } from "@/app/(workspace)/organisations/[orgId]/media/[assetId]/asset-detail-form";
import { MediaCleanupStatus } from "@/components/media/media-cleanup-status";
import { archiveMediaAction, deleteMediaAction } from "@/server/actions/media";
import type { MediaAsset, MediaDeletionStatus } from "@/core/domain/entities/media";

const asset: MediaAsset = {
  id: "asset-1", organisationId: "org-1", storagePath: "organisations/org-1/file.jpg",
  fileName: "file.jpg", mimeType: "image/jpeg", sizeBytes: 1024, width: null, height: null,
  uploadedBy: null, createdAt: "2026-08-15T00:00:00Z", title: "File", thumbnailPath: null,
  category: null, description: null, altText: null, tags: [], brand: null, duration: null,
  copyrightOwner: null, usageRights: null, expiresAt: null, isAiGenerated: false, isArchived: false,
  updatedAt: "2026-08-15T00:00:00Z",
};

function view(status: MediaDeletionStatus) {
  return render(<AssetDetailForm organisationId="org-1" asset={asset} versions={[]} signedUrl="" versionUrls={{}} deletionStatus={status} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("Media Safe Delete detail UI", () => {
  it("offers deliberate permanent deletion only for eligible unused media", async () => {
    vi.mocked(deleteMediaAction).mockResolvedValue({ status: "success", message: "Media deleted permanently." });
    view({ eligibility: "ELIGIBLE", reasons: [], totalBytes: 2048, objectCount: 2, fileName: "file.jpg" });
    expect(screen.getByText("Unused media")).toBeInTheDocument();
    expect(screen.getByText("Total known size: 2.0 KB")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Delete permanently" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "file.jpg" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(deleteMediaAction).toHaveBeenCalledWith("org-1", "asset-1"));
  });

  it("shows blocked reasons and no destructive control", () => {
    view({ eligibility: "BLOCKED", reasons: [{ code: "USED_BY_CONTENT", count: 2 }, { code: "USED_BY_CAMPAIGN", count: 1 }] });
    expect(screen.getByText("Protected media")).toBeInTheDocument();
    expect(screen.getByText("Used by 2 content items")).toBeInTheDocument();
    expect(screen.getByText("Used by 1 campaign")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
  });

  it("shows the non-destructive permission state for a contributor", () => {
    view({ eligibility: "BLOCKED", reasons: [{ code: "INSUFFICIENT_PERMISSION", count: 1 }] });
    expect(screen.getByText(/requires an account lead or platform administrator/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
  });

  it("keeps Archive available and separate from permanent deletion", async () => {
    vi.mocked(archiveMediaAction).mockResolvedValue({ status: "success", message: "Archived." });
    view({ eligibility: "BLOCKED", reasons: [{ code: "UNKNOWN_DEPENDENCY", count: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: "Archive asset" }));
    await waitFor(() => expect(archiveMediaAction).toHaveBeenCalledWith("org-1", "asset-1"));
    expect(screen.getByText("Archive is reversible and does not free Storage.")).toBeInTheDocument();
  });
});

describe("Media Safe Delete cleanup recovery UI", () => {
  it("persists an honest pending state without claiming recovered bytes", () => {
    render(<MediaCleanupStatus request={{
      requestId: "request-1", organisationId: "org-1", formerAssetId: "asset-1",
      objectPaths: ["organisations/org-1/file.jpg"], cleanupState: "pending", totalBytes: 2048,
    }} />);
    expect(screen.getByText("Media removed from Genesis. Storage cleanup pending.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Storage cleanup" })).toBeInTheDocument();
    expect(screen.queryByText(/Recovered known Storage size/)).not.toBeInTheDocument();
  });

  it("reports known recovered bytes only after cleanup completes", () => {
    render(<MediaCleanupStatus request={{
      requestId: "request-1", organisationId: "org-1", formerAssetId: "asset-1",
      objectPaths: ["organisations/org-1/file.jpg"], cleanupState: "complete", totalBytes: 2048,
    }} />);
    expect(screen.getByText("Storage cleanup complete.")).toBeInTheDocument();
    expect(screen.getByText("Recovered known Storage size: 2.0 KB.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Storage cleanup" })).not.toBeInTheDocument();
  });
});
