import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { AIProviderPort, AIGenerationOptions } from "@/core/application/ports/ai-provider-port";

// Assumes a local OpenAI-compatible endpoint like Ollama or LMStudio
const localOpenAI = createOpenAI({
  baseURL: process.env.LOCAL_AI_BASE_URL || "http://localhost:11434/v1",
  apiKey: "local",
});

export class LocalProvider implements AIProviderPort {
  private defaultModel = "llama3";

  async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
    const { text } = await aiGenerateText({
      model: localOpenAI(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      temperature: options?.temperature ?? 0.7,
    });
    return text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T> {
    const { object } = await aiGenerateObject({
      model: localOpenAI(options?.model || this.defaultModel),
      system: options?.systemPrompt,
      prompt,
      schema,
      temperature: options?.temperature ?? 0.1,
    });
    return object;
  }
}
