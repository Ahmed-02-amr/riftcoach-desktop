import type { CoachChatInput, CoachChatReply, CoachReport, CoachReportInput, PregamePlan } from "@riftcoach/core";

export interface CoachLLMProvider {
  readonly name: "ollama" | "openai-proxy";
  generatePostGameReport(input: CoachReportInput): Promise<CoachReport>;
  generateReviewChatReply?(input: CoachChatInput): Promise<CoachChatReply>;
  generatePregamePlan?(input: unknown): Promise<PregamePlan>;
}

export interface ProviderHealth {
  reachable: boolean;
  model?: string;
  modelAvailable?: boolean;
  models?: string[];
  error?: string;
}
