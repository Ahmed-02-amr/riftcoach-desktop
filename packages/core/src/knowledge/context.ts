import type { AppSettings } from "../types/settings";
import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import type { KnowledgeContext, KnowledgeSourceSnippet } from "../types/knowledge";
import { buildBenchmarkComparisons } from "./benchmarks";
import { buildMatchupTips } from "./matchups";

export function buildKnowledgeContext(params: {
  match: MatchContext;
  insights: CoachInsight[];
  settings: AppSettings;
  webSources?: KnowledgeSourceSnippet[];
  warnings?: string[];
}): KnowledgeContext {
  const { match, settings } = params;
  if (settings.knowledgeMode === "off") {
    return {
      mode: "off",
      evidenceMode: "telemetry_only",
      benchmarkComparisons: [],
      matchupTips: [],
      webSources: [],
      warnings: params.warnings ?? []
    };
  }

  const benchmarkComparisons = buildBenchmarkComparisons(match);
  const matchupTips = buildMatchupTips(match);
  const webSources = params.webSources ?? [];
  return {
    mode: settings.knowledgeMode,
    evidenceMode: webSources.length > 0 ? "telemetry_plus_web" : "telemetry_plus_benchmarks",
    benchmarkComparisons,
    matchupTips,
    webSources,
    warnings: params.warnings ?? []
  };
}
