import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { AIProviderPort, AIGenerationOptions, AIImageInput } from "@/core/application/ports/ai-provider-port";

export class GeminiProvider implements AIProviderPort {
  private defaultModel = "gemini-3.6-flash";

  async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
    const { text } = await aiGenerateText({
      model: google(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
    });
    return text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({
      model: google(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      schema,
    });
    return object;
  }

  async analyzeImage<T>(prompt: string, image: AIImageInput, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({ model: google(options?.model || this.defaultModel), system: options?.systemPrompt, prompt: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: image.data, mediaType: image.mediaType }] }], schema, temperature: options?.temperature ?? 0.1 });
    return object;
  }
}
