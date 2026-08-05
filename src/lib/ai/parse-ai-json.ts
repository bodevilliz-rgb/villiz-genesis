export class AiJsonParseError extends Error {
  readonly rawText: string;

  constructor(message: string, rawText: string) {
    super(message);
    this.name = "AiJsonParseError";
    this.rawText = rawText;
  }
}

function removeMarkdownFence(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function parseAiJson<TOutput>(rawText: string): TOutput {
  const cleanedText = removeMarkdownFence(rawText);

  try {
    return JSON.parse(cleanedText) as TOutput;
  } catch (error) {
    throw new AiJsonParseError(
      error instanceof Error
        ? `AI response was not valid JSON: ${error.message}`
        : "AI response was not valid JSON.",
      rawText,
    );
  }
}
