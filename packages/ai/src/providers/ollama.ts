import { CoachReportJsonSchema, type CoachChatInput, type CoachChatReply, type CoachReport, type CoachReportInput } from "@riftcoach/core";
import { buildPostGameCoachMessages } from "../prompt-builder";
import { buildReviewChatMessages } from "../review-chat-builder";
import type { CoachLLMProvider, ProviderHealth } from "../provider";
import { attachReportMetadata, parseJsonObject, withInferredReviewType } from "../validation";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  contextTokens?: number;
  outputTokens?: number;
  timeoutMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

export class OllamaCoachProvider implements CoachLLMProvider {
  readonly name = "ollama" as const;

  constructor(private readonly options: OllamaProviderOptions) {}

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(new URL("/api/tags", this.options.baseUrl), { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { reachable: false, model: this.options.model, error: `HTTP ${response.status}` };

      const json = (await response.json()) as OllamaTagsResponse;
      const models = (json.models ?? []).map((entry) => entry.name ?? entry.model).filter((name): name is string => Boolean(name));
      const modelAvailable = models.includes(this.options.model);
      return {
        reachable: true,
        model: this.options.model,
        modelAvailable,
        models,
        error: modelAvailable ? undefined : `Model "${this.options.model}" is not installed. Run: ollama pull ${this.options.model}`
      };
    } catch (error) {
      return { reachable: false, model: this.options.model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generatePostGameReport(input: CoachReportInput): Promise<CoachReport> {
    const messages = buildPostGameCoachMessages(input);
    const timeoutMs = this.options.timeoutMs ?? 10 * 60 * 1000;
    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", this.options.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: CoachReportJsonSchema,
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_ctx: this.options.contextTokens ?? 16_384,
            num_predict: this.options.outputTokens ?? 8_192
          },
          messages
        })
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Ollama generation timed out after ${formatTimeout(timeoutMs)}. Increase the Ollama timeout in Settings or use a smaller/faster model.`);
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as any;
    const content = json?.message?.content;
    if (typeof content !== "string") throw new Error("Ollama response did not include message.content.");
    const payload = withInferredReviewType(parseJsonObject(content), input);
    return attachReportMetadata({ payload, sessionId: input.match.sessionId, provider: "ollama", model: this.options.model });
  }

  async generateReviewChatReply(input: CoachChatInput): Promise<CoachChatReply> {
    const messages = buildReviewChatMessages(input);
    const timeoutMs = this.options.timeoutMs ?? 10 * 60 * 1000;
    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", this.options.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          options: {
            temperature: 0.28,
            top_p: 0.9,
            num_ctx: this.options.contextTokens ?? 16_384,
            num_predict: Math.max(1024, Math.min(this.options.outputTokens ?? 8_192, 8_192))
          },
          messages
        })
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Ollama chat timed out after ${formatTimeout(timeoutMs)}. Increase the Ollama timeout in Settings or use a smaller/faster model.`);
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama chat request failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as any;
    const content = json?.message?.content;
    if (typeof content !== "string") throw new Error("Ollama chat response did not include message.content.");
    return {
      content: content.trim(),
      sources: input.webSources ?? [],
      warnings: input.webWarnings ?? []
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError" || error instanceof Error && /aborted|timeout/i.test(error.message);
}

function formatTimeout(timeoutMs: number): string {
  const minutes = timeoutMs / 60000;
  if (minutes >= 1) return `${Number(minutes.toFixed(minutes >= 10 ? 0 : 1))} minutes`;
  return `${Math.round(timeoutMs / 1000)} seconds`;
}
