import { z } from "zod";

export interface AIGenerationOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
}

export interface AIProviderPort {
  /**
   * Generates text based on a prompt.
   */
  generateText(prompt: string, options?: AIGenerationOptions): Promise<string>;
  
  /**
   * Generates a structured JSON object based on a prompt and a Zod schema.
   */
  generateObject<T>(prompt: string, schema: z.ZodType<T>, options?: AIGenerationOptions): Promise<T>;
}
