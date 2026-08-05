export const AI_PROMPT_TYPES = [
  "caption_generation",
  "campaign_generation",
  "platform_repurpose",
  "brand_validation",
  "hashtag_generation",
  "visual_direction",
] as const;

export type AiPromptType = (typeof AI_PROMPT_TYPES)[number];

export const AI_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface AiGenerationRequest {
  promptType: AiPromptType;
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
}

export interface AiGenerationResponse<TOutput = unknown> {
  output: TOutput;
  rawText: string;
  provider: string;
  model: string;
  usage?: AiUsage;
}

export interface AiPromptTemplate {
  id: string;
  workspaceId: string | null;
  name: string;
  slug: string;
  description: string | null;
  promptType: AiPromptType;
  systemPrompt: string;
  userPromptTemplate: string;
  model: string;
  temperature: number;
  maxTokens: number;
  version: number;
  isActive: boolean;
  isSystemDefault: boolean;
}
