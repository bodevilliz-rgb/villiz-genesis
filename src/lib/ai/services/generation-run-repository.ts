import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AiPromptType,
  AiUsage,
} from "@/lib/ai/types";

interface CreateGenerationRunInput {
  workspaceId: string;
  promptTemplateId?: string | null;
  draftId?: string | null;
  campaignId?: string | null;
  promptType: AiPromptType;
  model: string;
  inputData: Record<string, unknown>;
  createdBy?: string | null;
}

interface CompleteGenerationRunInput {
  runId: string;
  outputData: unknown;
  validationResult?: unknown;
  usage?: AiUsage;
}

export class GenerationRunRepository {
  constructor(
    private readonly supabase: SupabaseClient,
  ) {}

  async create(
    input: CreateGenerationRunInput,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from("ai_generation_runs")
      .insert({
        workspace_id: input.workspaceId,
        prompt_template_id: input.promptTemplateId ?? null,
        draft_id: input.draftId ?? null,
        campaign_id: input.campaignId ?? null,
        prompt_type: input.promptType,
        model: input.model,
        input_data: input.inputData,
        status: "processing",
        created_by: input.createdBy ?? null,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(
        `Failed to create AI generation run: ${error.message}`,
      );
    }

    const row = data as unknown as { id: string };

    return row.id;
  }

  async complete(
    input: CompleteGenerationRunInput,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("ai_generation_runs")
      .update({
        output_data: input.outputData,
        validation_result: input.validationResult ?? null,
        status: "completed",
        input_tokens: input.usage?.inputTokens ?? null,
        output_tokens: input.usage?.outputTokens ?? null,
        estimated_cost: input.usage?.estimatedCost ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.runId);

    if (error) {
      throw new Error(
        `Failed to complete AI generation run: ${error.message}`,
      );
    }
  }

  async fail(
    runId: string,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("ai_generation_runs")
      .update({
        status: "failed",
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (error) {
      throw new Error(
        `Failed to record AI generation failure: ${error.message}`,
      );
    }
  }
}
