// @vitest-environment jsdom
/**
 * Test 10 — Suggestion is returned for review rather than automatically replacing the draft.
 *
 * Renders DraftForm with an empty body. Clicking "Apply AI" should call generateCaption()
 * and display the result in the suggestion panel, without touching the body textarea.
 * The user must explicitly click "Accept Suggestion" for the body to be updated.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Hoist mock fns so they are available inside vi.mock factories ─────────────

const { mockGenerateCaption, mockRewriteContent } = vi.hoisted(() => ({
  mockGenerateCaption: vi.fn().mockResolvedValue({
    text: "Luxury Wig Installation — where natural beauty meets expert care.",
  }),
  mockRewriteContent: vi.fn().mockResolvedValue({ text: "Rewritten content." }),
}));

// ── Mock every external dependency ────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/server/action-result", () => ({
  idleState: { status: "idle", message: "", fieldErrors: {} },
}));

vi.mock("@/server/actions/content", () => ({
  createDraftAction: vi.fn().mockResolvedValue({ status: "idle" }),
  updateDraftAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

vi.mock("@/server/actions/media", () => ({
  attachAssetToDraftAction: vi.fn(),
  detachAssetFromDraftAction: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      content: {
        draft: vi.fn((_orgId: string, id: string) => `/content/${id}`),
        index: vi.fn((_orgId: string) => `/content`),
      },
    },
  },
}));

vi.mock("@/server/actions/awo", () => ({
  generateCaption: mockGenerateCaption,
  rewriteContent: mockRewriteContent,
}));

// ── Component under test ──────────────────────────────────────────────────────

import { DraftForm } from "@/components/content/draft-form";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-mervic-001";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AWO AI Assist — suggestion returned for review (test 10)", () => {
  beforeEach(() => {
    mockGenerateCaption.mockClear();
    mockRewriteContent.mockClear();
  });

  it("shows the AI suggestion in the suggestion panel without overwriting the draft body", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    // The body textarea should start empty (no draft supplied).
    const bodyEl = document.getElementById("body") as HTMLTextAreaElement;
    expect(bodyEl).not.toBeNull();
    expect(bodyEl.value).toBe("");

    // Click "Apply AI" — with an empty body the effective action is "generate".
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply ai/i }));
    });

    // generateCaption() must have been called, not rewriteContent().
    expect(mockGenerateCaption).toHaveBeenCalledTimes(1);
    expect(mockRewriteContent).not.toHaveBeenCalled();

    // The suggestion text must appear in the UI.
    expect(
      screen.getByText("Luxury Wig Installation — where natural beauty meets expert care."),
    ).toBeInTheDocument();

    // "Accept Suggestion" button must be present, proving user action is required.
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toBeInTheDocument();

    // The body textarea must NOT have been automatically updated.
    expect(bodyEl.value).toBe("");
  });

  it("calls generateCaption with the correct organisation ID (test 8 — component integration)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply ai/i }));
    });

    expect(mockGenerateCaption).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(String),
      expect.any(String),
    );
  });

  it("does not call rewriteContent() for an empty draft (test 6 — component integration)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply ai/i }));
    });

    expect(mockRewriteContent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// New spec tests 1–4: draftBody state synchronises after accepting a suggestion
// ---------------------------------------------------------------------------

describe("AWO AI Assist — draftBody state sync on Accept Suggestion (new spec 1–4)", () => {
  const SUGGESTION = "Luxury Wig Installation — where natural beauty meets expert care.";

  beforeEach(() => {
    mockGenerateCaption.mockClear();
    mockRewriteContent.mockClear();
  });

  async function generateAndAccept() {
    // Generate a suggestion (empty draft → generate path)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply ai/i }));
    });
    // Accept the suggestion
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept suggestion/i }));
    });
  }

  it("body textarea contains the accepted suggestion (new spec 4)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);
    await generateAndAccept();

    const bodyEl = document.getElementById("body") as HTMLTextAreaElement;
    expect(bodyEl.value).toBe(SUGGESTION);
  });

  it("Generate first draft option becomes disabled after accepting a non-empty suggestion (new spec 2)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    // Before acceptance: generate is available (draft is empty)
    const select = screen.getByRole("combobox", { name: /ai action selection/i });
    expect(select).toHaveValue("generate");

    await generateAndAccept();

    // After acceptance: draftBody is non-empty → generate option is disabled
    const generateOption = Array.from(
      (select as HTMLSelectElement).options,
    ).find((o) => o.value === "generate");
    expect(generateOption?.disabled).toBe(true);
  });

  it("Rewrite option becomes enabled after accepting a non-empty suggestion (new spec 3)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);
    await generateAndAccept();

    const select = screen.getByRole("combobox", { name: /ai action selection/i });
    const rewriteOption = Array.from(
      (select as HTMLSelectElement).options,
    ).find((o) => o.value === "rewrite");
    expect(rewriteOption?.disabled).toBe(false);
  });

  it("draftBody state is updated — the select reflects 'rewrite' not 'generate' after acceptance (new spec 1)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);
    await generateAndAccept();

    // effectiveAiAction is derived from draftBody; if draftBody were still "",
    // the select would remain on "generate". Showing "rewrite" proves state synced.
    const select = screen.getByRole("combobox", { name: /ai action selection/i });
    expect(select).toHaveValue("rewrite");
  });
});
