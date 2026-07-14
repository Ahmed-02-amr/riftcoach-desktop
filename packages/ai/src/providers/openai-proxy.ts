import type { CoachChatInput, CoachChatReply, CoachReport, CoachReportInput } from "@riftcoach/core";
import type { CoachLLMProvider, ProviderHealth } from "../provider";

export interface OpenAiProxyProviderOptions {
  apiBaseUrl: string;
  model: string;
  authToken?: string;
  timeoutMs?: number;
}

export class OpenAiProxyCoachProvider implements CoachLLMProvider {
  readonly name = "openai-proxy" as const;

  constructor(private readonly options: OpenAiProxyProviderOptions) {}

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(new URL("/health", this.options.apiBaseUrl), { signal: AbortSignal.timeout(2000) });
      return { reachable: response.ok, model: this.options.model, error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (error) {
      return { reachable: false, model: this.options.model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generatePostGameReport(input: CoachReportInput): Promise<CoachReport> {
    const response = await fetch(new URL("/v1/coach/report", this.options.apiBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.authToken ? { authorization: `Bearer ${this.options.authToken}` } : {})
      },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60000),
      body: JSON.stringify({ model: this.options.model, input })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI proxy request failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    return (await response.json()) as CoachReport;
  }

  async generateReviewChatReply(input: CoachChatInput): Promise<CoachChatReply> {
    const response = await fetch(new URL("/v1/coach/chat", this.options.apiBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.authToken ? { authorization: `Bearer ${this.options.authToken}` } : {})
      },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60000),
      body: JSON.stringify({ model: this.options.model, input })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI proxy chat request failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    return (await response.json()) as CoachChatReply;
  }
}
