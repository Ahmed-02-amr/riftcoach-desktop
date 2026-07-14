import type { MatchContext, UserProfileContext } from "./game";
import type { KnowledgeContext, KnowledgeSourceSnippet } from "./knowledge";
import type { AppSettings } from "./settings";

export type InsightCategory =
  | "laning"
  | "cs"
  | "vision"
  | "positioning"
  | "macro"
  | "teamfighting"
  | "objective_control"
  | "itemization"
  | "jungle_tempo"
  | "support_roaming"
  | "training_goal"
  | "visual_review";

export type InsightSeverity = "low" | "medium" | "high";

export interface CoachInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  confidence: number;
  title: string;
  evidence: string[];
  affectedTimestamps: number[];
  ruleSource: string;
  recommendedFocus: string;
  weight?: number;
}

export interface CoachReportInput {
  match: MatchContext;
  insights: CoachInsight[];
  profile?: UserProfileContext;
  settings: Pick<AppSettings, "coachTone" | "privacyMode" | "aiMode" | "knowledgeMode">;
  knowledge?: KnowledgeContext;
}

export interface CoachReport {
  id: string;
  sessionId: string;
  provider: "ollama" | "openai-proxy" | "deterministic";
  model?: string;
  createdAtIso: string;
  reviewType?: "coaching" | "casual_mode";
  summary: string;
  mainMistake: {
    title: string;
    explanation: string;
    evidence: string[];
    whyItMatters: string;
  };
  positiveHabit: {
    title: string;
    explanation: string;
  };
  timelineNotes: Array<{
    timestampSec: number;
    title: string;
    note: string;
  }>;
  nextGameDrill: {
    title: string;
    steps: string[];
    successMetric: string;
    duration: "next_game" | "next_3_games" | "next_5_games";
  };
  knowledgeContext?: KnowledgeContext;
  warnings: string[];
}

export type CoachChatRole = "user" | "assistant";

export interface CoachChatMessage {
  id: string;
  reportId: string;
  sessionId: string;
  role: CoachChatRole;
  content: string;
  createdAtIso: string;
  sources: KnowledgeSourceSnippet[];
  warnings: string[];
}

export interface CoachChatInput {
  report: CoachReport;
  match: MatchContext;
  insights: CoachInsight[];
  profile?: UserProfileContext;
  settings: Pick<AppSettings, "coachTone" | "privacyMode" | "aiMode" | "knowledgeMode">;
  knowledge?: KnowledgeContext;
  history: CoachChatMessage[];
  userMessage: string;
  webSources?: KnowledgeSourceSnippet[];
  webWarnings?: string[];
}

export interface CoachChatReply {
  content: string;
  sources: KnowledgeSourceSnippet[];
  warnings: string[];
}

export interface PregamePlan {
  summary: string;
  lanePlan: string[];
  dangerWindows: string[];
  buildConsiderations: string[];
  focusGoal: string;
}
