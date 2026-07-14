import type { PlayerRole, KnowledgeMode } from "./settings";

export interface BenchmarkComparison {
  metric: string;
  label: string;
  scope: string;
  playerValue?: number;
  median?: number;
  p25?: number;
  p75?: number;
  unit?: string;
  interpretation: "strong" | "above_average" | "average" | "below_average" | "needs_attention" | "unavailable";
  confidence: "low" | "medium" | "high";
  sampleSize?: number;
  source: string;
}

export interface MatchupTip {
  champion: string;
  role: PlayerRole;
  opponentChampion?: string;
  matchupDifficulty?: "easy" | "even" | "hard" | "unknown";
  lanePlan: string[];
  dangerWindows: string[];
  commonMistakes: string[];
  source: string;
  confidence: "low" | "medium" | "high";
}

export interface KnowledgeSourceSnippet {
  id: string;
  title: string;
  url: string;
  snippet: string;
  query: string;
  sourceType: "web" | "built-in" | "riot-static";
  reliability: "low" | "medium" | "high";
  fetchedAtIso: string;
}

export interface KnowledgeContext {
  mode: KnowledgeMode;
  evidenceMode: "telemetry_only" | "telemetry_plus_benchmarks" | "telemetry_plus_web";
  benchmarkComparisons: BenchmarkComparison[];
  matchupTips: MatchupTip[];
  webSources: KnowledgeSourceSnippet[];
  warnings: string[];
}
