import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { LocalProvider } from "./local-provider";

export function getAIProvider(): AIProviderPort {
  const providerName = process.env.AI_PROVIDER || "openai";
  
  switch (providerName.toLowerCase()) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "local":
      return new LocalProvider();
    case "openai":
    default:
      return new OpenAIProvider();
  }
}
