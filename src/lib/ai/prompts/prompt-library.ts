import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AiPromptTemplate,
  AiPromptType,
} from "@/lib/ai/types";

interface PromptTemplateRow {
  id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  prompt_type: AiPromptType;
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number | string;
  max_tokens: number;
  version: number;
  is_active: boolean;
  is_system_default: boolean;
}

export class PromptTemplateNotFoundError extends Error {
  constructor(options: {
    promptType: AiPromptType;
    workspaceId?: string;
    slug?: string;
  }) {
    const scope = options.workspaceId
      ? `workspace ${options.workspaceId}`
      : "system defaults";

    const slugText = options.slug
      ? ` with slug "${options.slug}"`
      : "";

    super(
      `No active ${options.promptType} prompt template${slugText} was found for ${scope}.`,
    );

    this.name = "PromptTemplateNotFoundError";
  }
}

function mapPromptTemplateRow(
  row: PromptTemplateRow,
): AiPromptTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    promptType: row.prompt_type,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    model: row.model,
    temperature: Number(row.temperature),
    maxTokens: row.max_tokens,
    version: row.version,
    isActive: row.is_active,
    isSystemDefault: row.is_system_default,
  };
}

export class PromptLibrary {
  constructor(
    private readonly supabase: SupabaseClient,
  ) {}

  async getActiveTemplate(options: {
    promptType: AiPromptType;
    workspaceId?: string;
    slug?: string;
  }): Promise<AiPromptTemplate> {
    const workspaceTemplate = options.workspaceId
      ? await this.findTemplate({
          promptType: options.promptType,
          workspaceId: options.workspaceId,
          slug: options.slug,
          systemDefaultOnly: false,
        })
      : null;

    if (workspaceTemplate) {
      return workspaceTemplate;
    }

    const systemTemplate = await this.findTemplate({
      promptType: options.promptType,
      workspaceId: null,
      slug: options.slug,
      systemDefaultOnly: true,
    });

    if (systemTemplate) {
      return systemTemplate;
    }

    throw new PromptTemplateNotFoundError(options);
  }

  private async findTemplate(options: {
    promptType: AiPromptType;
    workspaceId: string | null;
    slug?: string;
    systemDefaultOnly: boolean;
  }): Promise<AiPromptTemplate | null> {
    let query = this.supabase
      .from("ai_prompt_templates")
      .select(
        [
          "id",
          "workspace_id",
          "name",
          "slug",
          "description",
          "prompt_type",
          "system_prompt",
          "user_prompt_template",
          "model",
          "temperature",
          "max_tokens",
          "version",
          "is_active",
          "is_system_default",
        ].join(","),
      )
      .eq("prompt_type", options.promptType)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1);

    query =
      options.workspaceId === null
        ? query.is("workspace_id", null)
        : query.eq("workspace_id", options.workspaceId);

    if (options.systemDefaultOnly) {
      query = query.eq("is_system_default", true);
    }

    if (options.slug) {
      query = query.eq("slug", options.slug);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(
        `Failed to load AI prompt template: ${error.message}`,
      );
    }

    if (!data) {
      return null;
    }

    return mapPromptTemplateRow(data as unknown as PromptTemplateRow);
  }
}
