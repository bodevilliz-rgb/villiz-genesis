import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { AIProviderPort, AIGenerationOptions } from "@/core/application/ports/ai-provider-port";

export class AnthropicProvider implements AIProviderPort {
  private defaultModel = "claude-3-5-sonnet-20240620";

  async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
    const { text } = await aiGenerateText({
      model: anthropic(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      temperature: options?.temperature ?? 0.7,
    });
    return text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({
      model: anthropic(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      schema,
      temperature: options?.temperature ?? 0.1,
    });
    return object;
  }
}
