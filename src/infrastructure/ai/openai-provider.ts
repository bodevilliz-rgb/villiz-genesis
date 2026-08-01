import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { AIProviderPort, AIGenerationOptions } from "@/core/application/ports/ai-provider-port";

export class OpenAIProvider implements AIProviderPort {
  private defaultModel = "gpt-4o-mini";

  async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
    const { text } = await aiGenerateText({
      model: openai(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      temperature: options?.temperature ?? 0.7,
    });
    return text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({
      model: openai(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      schema,
      temperature: options?.temperature ?? 0.1, // lower temp for structured data
    });
    return object;
  }
}
