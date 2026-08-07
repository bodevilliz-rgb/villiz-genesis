import { z } from "zod";

import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type {
  GenerationReadiness,
  GroundingMetadata,
  PromptSpecification,
} from "@/core/domain/entities/generation";
import {
  PromptLibrary,
  PromptTemplateNotFoundError,
} from "@/lib/ai/prompts/prompt-library";
import { renderPromptTemplate } from "@/lib/ai/prompts/render-prompt";
import { GenerationRunRepository } from "@/lib/ai/services/generation-run-repository";
import {
  detectComplianceViolations,
  repairComplianceViolations,
} from "./compliance";

const ImprovedDraftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  summary: z.string().nullable().optional(),
  reasoning: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ImprovedDraftResult = z.infer<typeof ImprovedDraftSchema>;

interface GenerateImprovedDraftDeps {
  aiProvider: AIProviderPort;
  promptLibrary: PromptLibrary;
  generationRuns: GenerationRunRepository;
}

interface GenerateImprovedDraftInput {
  organisationId: string;
  draftId: string;
  requestedBy: string;
  readiness: GenerationReadiness;
  additionalInstructions?: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are Genesis Content Intelligence, an expert brand-aware content editor.",
  "",
  "FACTUAL BOUNDARY — this is the most important rule:",
  "Every factual business claim must be directly supported by the supplied brand context. Faithful paraphrasing is allowed, provided it does not introduce, strengthen, quantify or materially alter the underlying fact.",
  "If a detail is entirely absent from the brand context, omit it rather than inventing a plausible substitute. Do not substitute industry averages, plausible numbers, or common assumptions.",
  "Do not generalise from what similar businesses typically offer. Only use facts explicitly present in the brand context.",
  "",
  "WHAT YOU MAY IMPROVE:",
  "Grammar, sentence structure, clarity, flow, and call-to-action phrasing are yours to improve freely.",
  "You may rearrange, condense, or expand sentences — provided you introduce no new factual claim in doing so.",
  "",
  "RESTRICTIONS:",
  "Follow all brand restrictions listed in the constraints section exactly.",
  "If a restriction prohibits a word or claim, that word or claim must not appear anywhere in the output.",
  "",
  "FORMAT:",
  "Preserve the original intent while improving clarity, structure, relevance, and call to action.",
  "Return only content that matches the requested structured schema.",
].join("\n");

function serializePromptSpecification(
  specification: PromptSpecification,
  additionalInstructions?: string,
): string {
  return JSON.stringify(
    {
      task: "Improve the existing content draft.",
      specification,
      additionalInstructions: additionalInstructions || null,
      outputRequirements: {
        title: "A polished title appropriate for the content type.",
        body: "The complete improved draft.",
        summary: "A concise internal summary of the improved content.",
        reasoning: "A short list explaining the most important improvements.",
        warnings: "Any remaining brand, factual, or campaign risks.",
      },
    },
    null,
    2,
  );
}

export async function generateImprovedDraft(
  deps: GenerateImprovedDraftDeps,
  input: GenerateImprovedDraftInput,
): Promise<ImprovedDraftResult> {
  if (!input.readiness.promptReady) {
    throw new Error(
      input.readiness.blockingReasons.length > 0
        ? `Draft is not ready for generation: ${input.readiness.blockingReasons.join(" ")}`
        : "Draft is not ready for generation.",
    );
  }

  let template:
    | Awaited<ReturnType<PromptLibrary["getActiveTemplate"]>>
    | null = null;

  try {
    template = await deps.promptLibrary.getActiveTemplate({
      organisationId: input.organisationId,
      promptType: "caption_generation",
      slug: "improve-draft",
    });
  } catch (error) {
    if (!(error instanceof PromptTemplateNotFoundError)) {
      throw error;
    }
  }

  const promptSpecification = serializePromptSpecification(
    input.readiness.promptSpecification,
    input.additionalInstructions,
  );

  const prompt = template
    ? renderPromptTemplate(template.userPromptTemplate, {
        organisation_name:
          input.readiness.context.organisation.name,
        content_type:
          input.readiness.context.draft.contentType,
        draft_title:
          input.readiness.context.draft.title,
        draft_body:
          input.readiness.context.draft.body,
        generation_context: promptSpecification,
        additional_instructions:
          input.additionalInstructions ?? "",
      })
    : promptSpecification;

  const model = template?.model ?? "gpt-4o-mini";

  const runId = await deps.generationRuns.create({
    organisationId: input.organisationId,
    promptTemplateId: template?.id ?? null,
    draftId: input.draftId,
    campaignId:
      input.readiness.context.campaign?.id ?? null,
    promptType: "caption_generation",
    model,
    inputData: {
      draftId: input.draftId,
      promptSpecification:
        input.readiness.promptSpecification,
      additionalInstructions:
        input.additionalInstructions ?? null,
    },
    createdBy: input.requestedBy,
  });

  try {
    const rawResult = await deps.aiProvider.generateObject(
      prompt,
      ImprovedDraftSchema,
      {
        model,
        systemPrompt:
          template?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        temperature: template?.temperature ?? 0.4,
      },
    );

    // Post-generation compliance: lexical check + coherence-safe repair (no second AI call).
    const restrictions = input.readiness.context.brand.restrictions;
    const violations = detectComplianceViolations(rawResult.body, restrictions);
    const repairResult = repairComplianceViolations(rawResult.body, violations);

    const complianceWarnings: string[] = [];
    if (violations.length > 0) {
      if (repairResult.safe) {
        complianceWarnings.push(
          `Compliance repair removed ${violations.length} prohibited term(s): ${violations.join(", ")}.`,
        );
      } else {
        complianceWarnings.push(
          `REVIEW REQUIRED: Found ${violations.length} prohibited term(s) (${violations.join(", ")}) but safe automatic repair was not possible. This output must be reviewed by a human before use.`,
        );
      }
    }

    const result = {
      ...rawResult,
      body: repairResult.body,
      summary: rawResult.summary ?? null,
      reasoning: rawResult.reasoning ?? [],
      warnings: [...(rawResult.warnings ?? []), ...complianceWarnings],
    };

    // Grounding metadata — stored in the existing validation_result JSON column.
    const categoriesUsed = (
      Object.entries(input.readiness.context.brand) as [string, string[]][]
    )
      .filter(([, entries]) => entries.length > 0)
      .map(([key]) => key);

    const grounding: GroundingMetadata = {
      categoriesUsed,
      knowledgeEntryIds: [],
      complianceChecked: true,
      complianceViolationsFound: violations.length,
      complianceViolationsRepaired: repairResult.safe ? violations.length : 0,
    };

    await deps.generationRuns.complete({
      runId,
      outputData: result,
      validationResult: {
        promptReady: input.readiness.promptReady,
        confidence:
          input.readiness.confidence.score,
        knowledgeCoverage:
          input.readiness.knowledgeCoverage.coveragePercent,
        campaignReadiness:
          input.readiness.campaignReadiness?.score ?? null,
        draftReadiness:
          input.readiness.draftAnalysis.readinessPercent,
        grounding,
      },
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI generation failure.";

    try {
      await deps.generationRuns.fail(runId, message);
    } catch (auditError) {
      console.error(
        "[genesis] failed to record AI generation failure",
        auditError,
      );
    }

    throw error;
  }
}
