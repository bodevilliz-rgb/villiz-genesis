import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { AIProviderPort, AIGenerationOptions } from "@/core/application/ports/ai-provider-port";

export class GeminiProvider implements AIProviderPort {
  private defaultModel = "gemini-2.0-flash";

  async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
    const { text } = await aiGenerateText({
      model: google(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      temperature: options?.temperature ?? 0.7,
    });
    return text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({
      model: google(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      schema,
      temperature: options?.temperature ?? 0.1,
    });
    return object;
  }
}
