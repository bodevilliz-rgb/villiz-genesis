"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireContext } from "../container";
import { createOrganisation } from "@/core/application/use-cases/organisations";
import { createEntry } from "@/core/application/use-cases/membrain";
import { createCampaign } from "@/core/application/use-cases/campaigns";
import { createDraft } from "@/core/application/use-cases/content";
import { errorState, successState, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import type { AiPromptType } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// Payload schema — the wizard submits everything as a single JSON blob.
// ---------------------------------------------------------------------------
const setupPayloadSchema = z.object({
  // Step 1 — Business
  businessName: z.string().trim().min(1, "Business name is required").max(120),
  industry: z.string().trim().max(80).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  location: z.string().trim().max(120).optional().default(""),
  brandColour: z.string().trim().optional().default(""),

  // Step 2 — Brand
  mission: z.string().trim().max(1000).optional().default(""),
  brandStory: z.string().trim().max(5000).optional().default(""),
  brandVoice: z.string().trim().min(1, "Brand voice is required").max(2000),
  tone: z.string().trim().max(200).optional().default(""),
  personality: z.string().trim().max(500).optional().default(""),
  targetAudience: z.string().trim().min(1, "Target audience is required").max(2000),

  // Step 3 — Products
  products: z.string().trim().min(1, "Products or services are required").max(5000),
  services: z.string().trim().max(5000).optional().default(""),
  keyOffers: z.string().trim().max(2000).optional().default(""),
  uniqueSellingPoints: z.string().trim().max(2000).optional().default(""),
  competitors: z.string().trim().max(2000).optional().default(""),

  // Step 4 — Content
  contentPillars: z.string().trim().min(1, "Content pillars are required").max(5000),
  restrictions: z.string().trim().max(5000).optional().default(""),
  preferredCTA: z.string().trim().max(500).optional().default(""),
  preferredPlatforms: z.string().trim().max(500).optional().default(""),
  postingFrequency: z.string().trim().max(200).optional().default(""),
});

export type SetupPayload = z.infer<typeof setupPayloadSchema>;

// ---------------------------------------------------------------------------
// Default prompt templates created for every new organisation.
// ---------------------------------------------------------------------------
const DEFAULT_PROMPT_TEMPLATES: Array<{
  name: string;
  slug: string;
  description: string;
  promptType: AiPromptType;
  systemPrompt: string;
  userPromptTemplate: string;
}> = [
  {
    name: "Caption Generation",
    slug: "caption-generation",
    description: "Generates on-brand social media captions for posts and campaigns.",
    promptType: "caption_generation",
    systemPrompt:
      "You are an expert social media copywriter. Write engaging, platform-appropriate captions that match the brand voice and drive the requested action. Output only the caption text — no commentary, no options list, no label.",
    userPromptTemplate:
      "Write a {{platform}} caption for the following:\n\nBrief: {{brief}}\nBrand voice: {{brand_voice}}\nTarget audience: {{target_audience}}\nCTA: {{cta}}\n\nCaption:",
  },
  {
    name: "Campaign Generation",
    slug: "campaign-generation",
    description: "Generates campaign concepts aligned with the brand's strategy and objectives.",
    promptType: "campaign_generation",
    systemPrompt:
      "You are a strategic campaign planner specialising in social media. Generate focused, actionable campaign concepts with a clear narrative arc. Output structured JSON with fields: name, objective, keyMessage, contentAngles (array of 3–5 strings), and suggestedPlatforms (array).",
    userPromptTemplate:
      "Generate a social media campaign concept.\n\nBrand: {{brand_name}}\nObjective: {{objective}}\nDuration: {{duration}}\nTarget audience: {{target_audience}}\nKey message: {{key_message}}\nContent pillars: {{content_pillars}}",
  },
  {
    name: "Brand Validation",
    slug: "brand-validation",
    description: "Evaluates draft content for brand voice consistency and compliance with guidelines.",
    promptType: "brand_validation",
    systemPrompt:
      'You are a brand guardian. Evaluate the content against the provided brand guidelines and restrictions. Output JSON with: result ("PASS" or "FAIL"), score (0–100), issues (array of strings, empty if none), suggestions (array of improvement strings).',
    userPromptTemplate:
      "Review this content for brand alignment:\n\nContent: {{content}}\n\nBrand voice: {{brand_voice}}\nPersonality: {{personality}}\nRestrictions: {{restrictions}}\nTarget audience: {{target_audience}}",
  },
  {
    name: "Visual Direction",
    slug: "visual-direction",
    description: "Creates visual direction briefs and image-generation prompts for social posts.",
    promptType: "visual_direction",
    systemPrompt:
      "You are a creative director for social media. Generate precise visual direction briefs that a designer or image AI can act on immediately. Describe composition, colour mood, lighting, subject, and style. Output a single concise brief, no more than 150 words.",
    userPromptTemplate:
      "Create a visual direction brief for:\n\nPost concept: {{brief}}\nBrand personality: {{personality}}\nBrand colour: {{brand_colour}}\nPlatform: {{platform}}\nMood/tone: {{tone}}",
  },
  {
    name: "Platform Repurposing",
    slug: "platform-repurposing",
    description: "Adapts existing content for a different social media platform and its conventions.",
    promptType: "platform_repurpose",
    systemPrompt:
      "You are a content strategist who adapts content between social media platforms. Reformat and rewrite for the target platform's conventions (character limits, tone, hashtag norms, link handling) while preserving the original message and brand voice. Output only the repurposed content.",
    userPromptTemplate:
      "Repurpose the following content for {{target_platform}}:\n\nOriginal content ({{source_platform}}): {{original_content}}\n\nBrand voice: {{brand_voice}}\nTarget audience: {{target_audience}}",
  },
];

// ---------------------------------------------------------------------------
// Week 1 calendar — 5 content ideas, no AI generation.
// ---------------------------------------------------------------------------
const WEEK_1_CALENDAR: Array<{ title: string; body: string }> = [
  {
    title: "Brand Introduction",
    body: "Introduce who you are, what you do, and why you exist. Share your founding story or core mission in a way that resonates with your audience. Focus on the problem you solve, not just what you sell.",
  },
  {
    title: "Behind the Scenes",
    body: "Take your audience behind the scenes of how your business operates. Show your process, your team, or a typical day. Authenticity builds trust — choose a moment that reflects your brand values.",
  },
  {
    title: "Product or Service Spotlight",
    body: "Highlight your flagship offering. Explain what it is, how it works, and the transformation it delivers. Use real outcomes or specific results to make it tangible for your audience.",
  },
  {
    title: "Customer Perspective",
    body: "Share a story from the perspective of someone you help. Describe their situation before and after working with you. Use empathetic language that mirrors how your target audience talks about their own challenges.",
  },
  {
    title: "Value & Community Post",
    body: "Lead with value — share a tip, insight, or resource that your audience can use today without paying you anything. Position yourself as a trusted source of expertise in your space.",
  },
];

// ---------------------------------------------------------------------------
// Server action
// ---------------------------------------------------------------------------
export async function runSetupAssistantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const context = await requireContext();

    if (!context.actor.isPlatformAdmin) {
      return { status: "error", message: "Only platform administrators can run the Setup Assistant." };
    }

    const raw = formData.get("data");
    if (typeof raw !== "string" || !raw) {
      return { status: "error", message: "Setup data is missing." };
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: "error", message: "Setup data could not be parsed." };
    }

    const parsed = setupPayloadSchema.safeParse(json);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      return { status: "error", message: first ?? "Please complete all required fields." };
    }

    const data = parsed.data;

    // -----------------------------------------------------------------------
    // 1. Create Organisation
    // -----------------------------------------------------------------------
    const org = await createOrganisation(
      { actor: context.actor, organisations: context.organisations },
      {
        name: data.businessName,
        industry: data.industry,
        websiteUrl: data.websiteUrl,
        status: "prospect" as const,
        brandColour: data.brandColour,
      },
    );

    const orgId = org.id;
    const membrainDeps = {
      actor: context.actor,
      membrain: context.membrain,
      organisations: context.organisations,
    };

    // -----------------------------------------------------------------------
    // 2. Populate MemBrain — look up category IDs by key, then write entries.
    //    Existing entries in a category are not overwritten (the org is new,
    //    so there should be none, but the check is here for robustness).
    // -----------------------------------------------------------------------
    const categories = await context.membrain.listCategories(orgId);
    const catByKey = Object.fromEntries(categories.map((c) => [c.key, c]));

    const membrainEntries: Array<{ key: string; title: string; body: string; importance: number }> = [
      {
        key: "brand_description",
        title: "Brand Description",
        body: [
          data.mission ? `Mission: ${data.mission}` : null,
          data.brandStory ? `Brand story: ${data.brandStory}` : null,
          data.location ? `Location: ${data.location}` : null,
          data.websiteUrl ? `Website: ${data.websiteUrl}` : null,
        ]
          .filter(Boolean)
          .join("\n\n") || `${data.businessName} — ${data.industry || "brand"}.`,
        importance: 5,
      },
      {
        key: "brand_voice",
        title: "Brand Voice & Tone",
        body: [
          `Brand voice: ${data.brandVoice}`,
          data.tone ? `Tone: ${data.tone}` : null,
          data.personality ? `Personality: ${data.personality}` : null,
          data.preferredCTA ? `Preferred CTA style: ${data.preferredCTA}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        importance: 5,
      },
      {
        key: "audience",
        title: "Target Audience",
        body: data.targetAudience,
        importance: 4,
      },
      {
        key: "offering",
        title: "Products & Services",
        body: [
          `Products: ${data.products}`,
          data.services ? `Services: ${data.services}` : null,
          data.keyOffers ? `Key offers: ${data.keyOffers}` : null,
          data.uniqueSellingPoints ? `Unique selling points: ${data.uniqueSellingPoints}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        importance: 4,
      },
      {
        key: "content_pillars",
        title: "Content Pillars",
        body: [
          data.contentPillars,
          data.preferredPlatforms ? `Preferred platforms: ${data.preferredPlatforms}` : null,
          data.postingFrequency ? `Posting frequency: ${data.postingFrequency}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        importance: 4,
      },
      {
        key: "guidelines",
        title: "Rules & Restrictions",
        body: data.restrictions || "No specific restrictions noted at onboarding.",
        importance: 4,
      },
    ];

    for (const entry of membrainEntries) {
      const category = catByKey[entry.key];
      if (!category) continue;

      // Skip if this category already has entries (robustness guard).
      const existing = await context.membrain.listRecent(orgId, 1);
      const categoryAlreadyHasEntry = existing.some((e) => e.category?.key === entry.key);
      if (categoryAlreadyHasEntry) continue;

      await createEntry(membrainDeps, {
        organisationId: orgId,
        title: entry.title,
        body: entry.body,
        categoryId: category.id,
        status: "active" as const,
        source: "client_brief" as const,
        importance: entry.importance,
        tags: [],
      });
    }

    // -----------------------------------------------------------------------
    // 3. Create default Prompt Templates
    // -----------------------------------------------------------------------
    for (const template of DEFAULT_PROMPT_TEMPLATES) {
      await context.promptLibrary.createTemplateIfAbsent({
        organisationId: orgId,
        name: template.name,
        slug: template.slug,
        description: template.description,
        promptType: template.promptType,
        systemPrompt: template.systemPrompt,
        userPromptTemplate: template.userPromptTemplate,
        model: "claude-sonnet-5",
        temperature: 0.7,
        maxTokens: 1500,
        createdBy: context.actor.id,
      });
    }

    // -----------------------------------------------------------------------
    // 4. Create "Welcome Campaign"
    // -----------------------------------------------------------------------
    const campaignDeps = {
      actor: context.actor,
      campaigns: context.campaigns,
      content: context.content,
      organisations: context.organisations,
    };

    const campaign = await createCampaign(campaignDeps, {
      organisationId: orgId,
      name: "Welcome Campaign",
      description: "Auto-generated by the Genesis Setup Assistant. Rename and customise for your first real campaign.",
      objective: "Establish brand presence and introduce the brand to its target audience.",
      targetAudience: data.targetAudience,
      status: "planning" as const,
      platforms: [],
      teamMembers: [],
      tags: ["genesis", "onboarding"],
    });

    // -----------------------------------------------------------------------
    // 5. Generate Week 1 Content Calendar — 5 draft ideas, no AI.
    // -----------------------------------------------------------------------
    const contentDeps = {
      actor: context.actor,
      content: context.content,
      membrain: context.membrain,
      organisations: context.organisations,
    };

    for (const idea of WEEK_1_CALENDAR) {
      await createDraft(contentDeps, {
        organisationId: orgId,
        title: idea.title,
        contentType: "social_post" as const,
        campaignId: campaign.id,
        body: idea.body,
        priority: "medium" as const,
      });
    }

    revalidatePath(routes.organisations.index);
    revalidatePath(routes.dashboard);

    return successState(`${org.name} is ready. Genesis is set up.`, orgId);
  } catch (error) {
    return errorState(error);
  }
}
