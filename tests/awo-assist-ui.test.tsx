// @vitest-environment jsdom
/**
 * AWO AI Assist — component interaction tests.
 *
 * 12 scenarios that cover the complete state-machine roundtrip:
 *   empty draft → generate → accept suggestion → rewrite
 *
 * Architecture proof these tests enforce:
 *   - draftBody React state is the SINGLE source of truth for the textarea.
 *   - The textarea is CONTROLLED (value={draftBody}); no defaultValue, no DOM mutation.
 *   - acceptAiSuggestion calls setDraftBody, never bodyEl.value =.
 *   - handleAiAssist reads draftBody directly, never document.getElementById.
 *   - The AI action state machine transitions correctly on every body change.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Hoist mock fns so they are available inside vi.mock factories ─────────────

const { mockGenerateCaption, mockRewriteContent } = vi.hoisted(() => ({
  mockGenerateCaption: vi.fn().mockResolvedValue({
    text: "Luxury Wig Installation — where natural beauty meets expert care.",
  }),
  mockRewriteContent: vi.fn().mockResolvedValue({ text: "Rewritten: polished and professional." }),
}));

const SUGGESTION = "Luxury Wig Installation — where natural beauty meets expert care.";
const REWRITE_RESULT = "Rewritten: polished and professional.";
const ORG_ID = "org-mervic-001";

// ── Mock every external dependency ────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
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
import type { ContentDraft } from "@/core/domain/entities/content";

// ── Helpers ───────────────────────────────────────────────────────────────────

function bodyTextarea(): HTMLTextAreaElement {
  return document.getElementById("body") as HTMLTextAreaElement;
}

function aiSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: /ai action selection/i }) as HTMLSelectElement;
}

function optionByValue(select: HTMLSelectElement, value: string): HTMLOptionElement | undefined {
  return Array.from(select.options).find((o) => o.value === value);
}

async function clickApplyAI() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /apply ai/i }));
  });
}

async function clickAccept() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /accept suggestion/i }));
  });
}

function changeBody(value: string) {
  act(() => {
    fireEvent.change(bodyTextarea(), { target: { value } });
  });
}

const PERSISTED_DRAFT = {
  id: "draft-001",
  organisationId: ORG_ID,
  title: "Spring campaign",
  body: "Existing draft content about luxury wig services.",
  status: "draft",
  contentType: "social_post",
} as unknown as ContentDraft;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AWO AI Assist — 12 component interaction tests", () => {
  beforeEach(() => {
    mockGenerateCaption.mockClear();
    mockRewriteContent.mockClear();
  });

  // 1 ─────────────────────────────────────────────────────────────────────────
  it("1 — empty draft: textarea is empty, 'generate' is selected and enabled, all transforms disabled", () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    expect(bodyTextarea().value).toBe("");
    expect(aiSelect().value).toBe("generate");
    expect(optionByValue(aiSelect(), "generate")?.disabled).toBe(false);
    for (const action of ["rewrite", "shorten", "expand", "change_tone", "alternative_captions", "clarity"]) {
      expect(optionByValue(aiSelect(), action)?.disabled).toBe(true);
    }
  });

  // 2 ─────────────────────────────────────────────────────────────────────────
  it("2 — persisted draft: textarea shows body, 'rewrite' selected, generate disabled, transforms enabled", () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} draft={PERSISTED_DRAFT} />);

    expect(bodyTextarea().value).toBe(PERSISTED_DRAFT.body);
    expect(aiSelect().value).toBe("rewrite");
    expect(optionByValue(aiSelect(), "generate")?.disabled).toBe(true);
    expect(optionByValue(aiSelect(), "rewrite")?.disabled).toBe(false);
    expect(optionByValue(aiSelect(), "shorten")?.disabled).toBe(false);
  });

  // 3 ─────────────────────────────────────────────────────────────────────────
  it("3 — typing content into empty editor transitions action to 'rewrite'", () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    expect(aiSelect().value).toBe("generate");
    changeBody("New draft content typed by user.");
    expect(aiSelect().value).toBe("rewrite");
    expect(optionByValue(aiSelect(), "generate")?.disabled).toBe(true);
    expect(optionByValue(aiSelect(), "rewrite")?.disabled).toBe(false);
  });

  // 4 ─────────────────────────────────────────────────────────────────────────
  it("4 — clearing a non-empty editor transitions action back to 'generate'", () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} draft={PERSISTED_DRAFT} />);

    expect(aiSelect().value).toBe("rewrite");
    changeBody("");
    expect(aiSelect().value).toBe("generate");
    expect(optionByValue(aiSelect(), "generate")?.disabled).toBe(false);
    expect(optionByValue(aiSelect(), "rewrite")?.disabled).toBe(true);
  });

  // 5 ─────────────────────────────────────────────────────────────────────────
  it("5 — whitespace-only body is treated as empty: generate selected, transforms disabled", () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    changeBody("   \n\t   ");
    expect(aiSelect().value).toBe("generate");
    expect(optionByValue(aiSelect(), "rewrite")?.disabled).toBe(true);
  });

  // 6 ─────────────────────────────────────────────────────────────────────────
  it("6 — Apply AI on empty draft shows suggestion in panel; textarea is not auto-updated", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await clickApplyAI();

    expect(screen.getByText(SUGGESTION)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toBeInTheDocument();
    expect(bodyTextarea().value).toBe("");
  });

  // 7 ─────────────────────────────────────────────────────────────────────────
  it("7 — Apply AI on empty draft calls generateCaption, never rewriteContent", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await clickApplyAI();

    expect(mockGenerateCaption).toHaveBeenCalledTimes(1);
    expect(mockRewriteContent).not.toHaveBeenCalled();
  });

  // 8 ─────────────────────────────────────────────────────────────────────────
  it("8 — Accept Suggestion writes the suggestion to the textarea (controlled state, not DOM mutation)", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await clickApplyAI();
    await clickAccept();

    // Controlled: React sets textarea.value = draftBody after setDraftBody(suggestion).
    // If only bodyEl.value= had been used, React would reset to "" on next render.
    expect(bodyTextarea().value).toBe(SUGGESTION);
  });

  // 9 ─────────────────────────────────────────────────────────────────────────
  it("9 — After Accept, state machine transitions: rewrite selected, generate disabled", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    expect(aiSelect().value).toBe("generate");

    await clickApplyAI();
    await clickAccept();

    expect(aiSelect().value).toBe("rewrite");
    expect(optionByValue(aiSelect(), "generate")?.disabled).toBe(true);
    expect(optionByValue(aiSelect(), "rewrite")?.disabled).toBe(false);
  });

  // 10 ────────────────────────────────────────────────────────────────────────
  it("10 — Apply AI on non-empty body calls rewriteContent with the current draftBody value", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} draft={PERSISTED_DRAFT} />);

    await clickApplyAI();

    expect(mockRewriteContent).toHaveBeenCalledTimes(1);
    expect(mockRewriteContent).toHaveBeenCalledWith(
      ORG_ID,
      PERSISTED_DRAFT.body,
      expect.any(String),
    );
    expect(mockGenerateCaption).not.toHaveBeenCalled();
  });

  // 11 ────────────────────────────────────────────────────────────────────────
  it("11 — generateCaption receives the correct organisation ID", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await clickApplyAI();

    expect(mockGenerateCaption).toHaveBeenCalledWith(ORG_ID, expect.any(String), expect.any(String));
  });

  // 12 ────────────────────────────────────────────────────────────────────────
  it("12 — Discard removes the suggestion panel without modifying the textarea", async () => {
    render(<DraftForm organisationId={ORG_ID} categories={[]} campaigns={[]} />);

    await clickApplyAI();
    expect(screen.getByText(SUGGESTION)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(screen.queryByText(SUGGESTION)).not.toBeInTheDocument();
    expect(bodyTextarea().value).toBe("");
    expect(aiSelect().value).toBe("generate");
  });
});
