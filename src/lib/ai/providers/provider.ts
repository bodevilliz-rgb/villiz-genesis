import type {
  AiGenerationRequest,
  AiGenerationResponse,
} from "@/lib/ai/types";

export interface AiProvider {
  readonly name: string;

  generate<TOutput = unknown>(
    request: AiGenerationRequest,
  ): Promise<AiGenerationResponse<TOutput>>;
}

export class AiProviderError extends Error {
  readonly provider: string;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(options: {
    message: string;
    provider: string;
    statusCode?: number;
    details?: unknown;
  }) {
    super(options.message);
    this.name = "AiProviderError";
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}
