import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject, generateText: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "model"), createOpenAI: vi.fn(() => vi.fn(() => "local-model")) }));

describe("AGIE request-scoped multimodal contract", () => {
  beforeEach(() => generateObject.mockReset());

  it("sends actual image bytes to a multimodal provider", async () => {
    generateObject.mockResolvedValue({ object: { observation: "visible portrait" } });
    const { OpenAIProvider } = await import("@/infrastructure/ai/openai-provider");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await new OpenAIProvider().analyzeImage!("Inspect safely", { data: bytes, mediaType: "image/png" }, z.object({ observation: z.string() }));
    expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({
      prompt: [expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: "image", image: bytes, mediaType: "image/png" })]) })],
    }));
  });

  it("keeps a non-multimodal local provider honest", async () => {
    const { LocalProvider } = await import("@/infrastructure/ai/local-provider");
    expect((new LocalProvider() as AIProviderPort).analyzeImage).toBeUndefined();
  });

  it("downloads only organisation-authorised selected assets and validates the returned pillar", () => {
    const source = readFileSync("src/server/actions/awo.ts", "utf8");
    expect(source).toContain("context.storage.downloadMedia(selectedImage.storagePath)");
    expect(source).toContain("selectedIdSet.has(asset.id)");
    expect(source).toContain("entry.status === \"active\"");
    expect(source).toContain("Awo could not select a valid active MemBrain content pillar");
    expect(source).toContain("MEDIA_SAFETY_PROMPT");
  });
});
