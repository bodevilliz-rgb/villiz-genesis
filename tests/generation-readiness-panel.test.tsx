// @vitest-environment jsdom
/**
 * Generation Readiness Panel — UI tests.
 *
 * Verifies Fix C: the panel explicitly communicates that readiness reflects
 * the last saved version of the draft, not unsaved editor state.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock("@/server/actions/content", () => ({
  createGenerationRequestAction: vi.fn(),
}));

vi.mock("@/server/action-result", () => ({
  idleState: { status: "idle", message: "", fieldErrors: {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Component under test ───────────────────────────────────────────────────────

import { GenerationReadinessPanel } from "@/components/content/generation-readiness-panel";
import type { GenerationReadiness } from "@/core/application/use-cases/generation";

// ── Minimal readiness fixture ─────────────────────────────────────────────────

const MINIMAL_READINESS: GenerationReadiness = {
  status: "needs_attention",
  promptReady: false,
  blockingReasons: ["An active Brand Description entry is required in MemBrain."],
  knowledgeCoverage: {
    coveragePercent: 83,
    categories: [
      { categoryKey: "brand_description", label: "Business/brand description", state: "missing", entryCount: 0, requiredCount: 1, suggestion: "Add an entry." },
      { categoryKey: "content_pillars", label: "At least three content pillars", state: "partial", entryCount: 2, requiredCount: 3, suggestion: "Add at least three." },
    ],
    missingCategories: [
      { categoryKey: "brand_description", label: "Business/brand description", state: "missing", entryCount: 0, requiredCount: 1, suggestion: "Add an entry." },
      { categoryKey: "content_pillars", label: "At least three content pillars", state: "partial", entryCount: 2, requiredCount: 3, suggestion: "Add at least three." },
    ],
    suggestedImprovements: ["Add an entry.", "Add at least three."],
  },
  campaignReadiness: null,
  draftAnalysis: {
    readinessPercent: 100,
    checks: [],
    suggestions: [],
    warnings: [],
  },
  confidence: {
    score: 74,
    reasoning: [],
    strengths: ["Brand voice is covered in MemBrain."],
    weaknesses: [],
    missingInformation: [],
  },
  promptSpecification: {
    systemContext: { role: "Content writer", principles: [] },
    businessContext: { organisationName: "Mervic", industry: null },
    campaignContext: null,
    brandContext: {
      brandDescription: [],
      brandVoice: ["Warm and professional."],
      targetAudience: [],
      contentPillars: [],
      productsAndServices: [],
      restrictions: [],
    },
    draftContext: { contentType: "social_post", title: "Luxury Wig Installation", currentBody: "", status: "draft" },
    generationGoal: "Generate a social post.",
    constraints: [],
  },
  context: {
    organisation: { id: "org-1", name: "Mervic", industry: null, websiteUrl: null },
    campaign: null,
    brand: {
      brandDescription: [],
      brandVoice: ["Warm and professional."],
      targetAudience: [],
      contentPillars: [],
      productsAndServices: [],
      restrictions: [],
    },
    draft: {
      id: "draft-1",
      contentType: "social_post",
      status: "draft",
      title: "Luxury Wig Installation",
      body: "",
      summary: null,
      category: null,
      version: 1,
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
    },
    requestedBy: { id: "user-1", fullName: "Villiz", email: "villizpixels@gmail.com" },
    assembledAt: "2026-08-07T00:00:00Z",
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GenerationReadinessPanel", () => {
  function renderPanel(readiness: GenerationReadiness = MINIMAL_READINESS) {
    return render(
      <GenerationReadinessPanel
        organisationId="org-1"
        draftId="draft-1"
        categories={[]}
        latestRequest={null}
        readiness={readiness}
        canWrite={false}
      />,
    );
  }

  it("12 — panel communicates that readiness reflects the last saved version of the draft", () => {
    renderPanel();
    expect(screen.getByText(/last saved version/i)).toBeInTheDocument();
  });

  it("shows Fix B: content_pillars partial count — '2 of 3 active entries'", () => {
    renderPanel();
    expect(screen.getByText(/2 of 3 active entries/i)).toBeInTheDocument();
  });

  it("shows Fix B: missing category with no active entry — 'no active entry'", () => {
    renderPanel();
    expect(screen.getByText(/no active entry/i)).toBeInTheDocument();
  });

  it("shows Fix A: specific brand description blocking reason", () => {
    renderPanel();
    expect(screen.getByText(/An active Brand Description entry is required in MemBrain\./i)).toBeInTheDocument();
  });

  it("shows Fix D: MemBrain gaps section header when non-complete categories exist", () => {
    renderPanel();
    expect(screen.getByText(/MemBrain gaps/i)).toBeInTheDocument();
  });

  it("shows the active-only note under MemBrain gaps", () => {
    renderPanel();
    expect(screen.getByText(/Only Active MemBrain entries count toward readiness/i)).toBeInTheDocument();
  });

  it("shows a strength badge from the readiness data", () => {
    renderPanel();
    expect(screen.getByText("Brand voice is covered in MemBrain.")).toBeInTheDocument();
  });

  it("does not show Draft gaps or Campaign gaps sections when all draft checks pass and no campaign", () => {
    renderPanel();
    expect(screen.queryByText(/Draft gaps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Campaign gaps/i)).not.toBeInTheDocument();
  });
});
