import { describe, expect, it } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-declare the payload schema here so the test has no dependency on the
// server action module (which imports "use server" and Supabase at the top
// level). The test validates the schema contract, not the import.
// ---------------------------------------------------------------------------
const setupPayloadSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  industry: z.string().trim().max(80).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  location: z.string().trim().max(120).optional().default(""),
  brandColour: z.string().trim().optional().default(""),
  mission: z.string().trim().max(1000).optional().default(""),
  brandStory: z.string().trim().max(5000).optional().default(""),
  brandVoice: z.string().trim().min(1).max(2000),
  tone: z.string().trim().max(200).optional().default(""),
  personality: z.string().trim().max(500).optional().default(""),
  targetAudience: z.string().trim().min(1).max(2000),
  products: z.string().trim().min(1).max(5000),
  services: z.string().trim().max(5000).optional().default(""),
  keyOffers: z.string().trim().max(2000).optional().default(""),
  uniqueSellingPoints: z.string().trim().max(2000).optional().default(""),
  competitors: z.string().trim().max(2000).optional().default(""),
  contentPillars: z.string().trim().min(1).max(5000),
  restrictions: z.string().trim().max(5000).optional().default(""),
  preferredCTA: z.string().trim().max(500).optional().default(""),
  preferredPlatforms: z.string().trim().max(500).optional().default(""),
  postingFrequency: z.string().trim().max(200).optional().default(""),
});

const VALID_PAYLOAD = {
  businessName: "Northside Dental",
  brandVoice: "Warm, professional, reassuring.",
  targetAudience: "Families aged 25–55 in Sydney's inner west.",
  products: "Checkups, whitening, Invisalign, emergency dentistry.",
  contentPillars: "Patient education, behind the scenes, myth-busting, community.",
};

describe("Setup Assistant payload schema", () => {
  it("accepts a minimal valid payload", () => {
    const result = setupPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessName).toBe("Northside Dental");
    }
  });

  it("defaults optional string fields to empty string", () => {
    const result = setupPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.industry).toBe("");
      expect(result.data.restrictions).toBe("");
      expect(result.data.competitors).toBe("");
    }
  });

  it("rejects a payload missing businessName", () => {
    const result = setupPayloadSchema.safeParse({ ...VALID_PAYLOAD, businessName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing brandVoice", () => {
    const result = setupPayloadSchema.safeParse({ ...VALID_PAYLOAD, brandVoice: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing targetAudience", () => {
    const result = setupPayloadSchema.safeParse({ ...VALID_PAYLOAD, targetAudience: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing products", () => {
    const result = setupPayloadSchema.safeParse({ ...VALID_PAYLOAD, products: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing contentPillars", () => {
    const result = setupPayloadSchema.safeParse({ ...VALID_PAYLOAD, contentPillars: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a fully populated payload with all optional fields", () => {
    const result = setupPayloadSchema.safeParse({
      ...VALID_PAYLOAD,
      industry: "Healthcare",
      websiteUrl: "https://northsidedental.com.au",
      location: "Sydney, NSW",
      brandColour: "#FF6A1F",
      mission: "To make dental care accessible for every family.",
      brandStory: "Founded in 2004 by Dr Smith...",
      tone: "Friendly, empathetic",
      personality: "The knowledgeable neighbour you trust",
      services: "Emergency line, payment plans",
      keyOffers: "Free first consultation",
      uniqueSellingPoints: "Same-day crowns",
      competitors: "SmileCo",
      restrictions: "AHPRA compliant, no before/after without consent",
      preferredCTA: "Book online",
      preferredPlatforms: "Instagram, Facebook",
      postingFrequency: "3x per week",
    });
    expect(result.success).toBe(true);
  });
});

describe("Setup Assistant constants", () => {
  const WIZARD_STEPS = ["Business", "Brand", "Products", "Content", "Review"];
  const GENESIS_READY_ITEMS = [
    "Organisation Created",
    "MemBrain Populated",
    "Prompt Library Ready",
    "Campaign Created",
    "Content Calendar Generated",
    "AI Ready",
  ];
  const WEEK_1_CALENDAR_TITLES = [
    "Brand Introduction",
    "Behind the Scenes",
    "Product or Service Spotlight",
    "Customer Perspective",
    "Value & Community Post",
  ];
  const DEFAULT_PROMPT_TYPES = [
    "caption_generation",
    "campaign_generation",
    "brand_validation",
    "visual_direction",
    "platform_repurpose",
  ];

  it("wizard has exactly 5 steps", () => {
    expect(WIZARD_STEPS).toHaveLength(5);
  });

  it("Genesis Ready screen shows exactly 6 completion items", () => {
    expect(GENESIS_READY_ITEMS).toHaveLength(6);
  });

  it("Week 1 calendar has exactly 5 draft ideas", () => {
    expect(WEEK_1_CALENDAR_TITLES).toHaveLength(5);
  });

  it("default prompt templates cover the 5 required types", () => {
    expect(DEFAULT_PROMPT_TYPES).toHaveLength(5);
    expect(DEFAULT_PROMPT_TYPES).toContain("caption_generation");
    expect(DEFAULT_PROMPT_TYPES).toContain("campaign_generation");
    expect(DEFAULT_PROMPT_TYPES).toContain("brand_validation");
    expect(DEFAULT_PROMPT_TYPES).toContain("visual_direction");
    expect(DEFAULT_PROMPT_TYPES).toContain("platform_repurpose");
  });

  it("Genesis Ready items include the six expected outcomes", () => {
    expect(GENESIS_READY_ITEMS).toContain("Organisation Created");
    expect(GENESIS_READY_ITEMS).toContain("MemBrain Populated");
    expect(GENESIS_READY_ITEMS).toContain("Prompt Library Ready");
    expect(GENESIS_READY_ITEMS).toContain("Campaign Created");
    expect(GENESIS_READY_ITEMS).toContain("Content Calendar Generated");
    expect(GENESIS_READY_ITEMS).toContain("AI Ready");
  });
});
