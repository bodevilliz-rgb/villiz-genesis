// @vitest-environment jsdom
/**
 * MediaUploadZone — duplicate-submission prevention and client fast-fail
 * validation for the direct-to-storage upload transport.
 *
 * U1 — duplicate click prevented: the upload button disables the moment the
 *      first click starts and stays disabled through every phase, so a
 *      double-click can never issue two upload tickets
 * U2 — an over-limit file is rejected in the browser with a clear message
 *      BEFORE any server request (requestMediaUploadAction never called)
 * U3 — an unsupported MIME type is rejected the same way
 */

vi.mock("@/server/actions/media", () => ({
  requestMediaUploadAction: vi.fn(),
  registerUploadedMediaAction: vi.fn(),
}));

vi.mock("@/infrastructure/supabase/browser-client", () => ({
  createBrowserSupabaseClient: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MediaUploadZone } from "@/components/media/media-upload-zone";
import { requestMediaUploadAction, registerUploadedMediaAction } from "@/server/actions/media";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser-client";
import { toast } from "sonner";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("U1 — duplicate submission prevented while an upload is in flight", () => {
  it("the button disables on first click; a second click issues no second ticket", async () => {
    let releaseTicket: (value: unknown) => void = () => {};
    vi.mocked(requestMediaUploadAction).mockImplementation(
      () => new Promise((resolve) => { releaseTicket = resolve; }) as never,
    );
    vi.mocked(createBrowserSupabaseClient).mockReturnValue({
      storage: { from: () => ({ uploadToSignedUrl: vi.fn(async () => ({ error: null })) }) },
    } as never);
    vi.mocked(registerUploadedMediaAction).mockResolvedValue({ status: "success", message: "ok", resourceId: "a1" } as never);

    render(<MediaUploadZone organisationId={ORG_ID} />);
    selectFile(makeFile("img.png", "image/png", 1024));

    const button = await screen.findByRole("button", { name: "Upload file" });
    fireEvent.click(button);

    // While the ticket request is pending, the button must be disabled and
    // show the in-flight state.
    await waitFor(() => expect(screen.getByRole("button", { name: /Preparing upload/ })).toBeDisabled());

    // A hammered second click cannot start a second flow.
    fireEvent.click(screen.getByRole("button", { name: /Preparing upload/ }));
    expect(requestMediaUploadAction).toHaveBeenCalledTimes(1);

    releaseTicket({ status: "ready", storagePath: `organisations/${ORG_ID}/1_img.png`, token: "t" });
    await waitFor(() => expect(registerUploadedMediaAction).toHaveBeenCalledTimes(1));
  });
});

describe("U2 — over-limit file fails immediately in the browser", () => {
  it("shows a clear error and never contacts the server", async () => {
    render(<MediaUploadZone organisationId={ORG_ID} />);
    selectFile(makeFile("huge.png", "image/png", 51 * 1024 * 1024));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining("maximum supported upload size is 50 MB")),
    );
    expect(requestMediaUploadAction).not.toHaveBeenCalled();
    // The file was never accepted into the selection, so no upload button appears.
    expect(screen.queryByRole("button", { name: "Upload file" })).not.toBeInTheDocument();
  });
});

describe("U3 — unsupported MIME type fails immediately in the browser", () => {
  it("audio files (never accepted by the bucket) are rejected before any server request", async () => {
    render(<MediaUploadZone organisationId={ORG_ID} />);
    selectFile(makeFile("song.mp3", "audio/mpeg", 1024));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining("not supported")),
    );
    expect(requestMediaUploadAction).not.toHaveBeenCalled();
  });
});
