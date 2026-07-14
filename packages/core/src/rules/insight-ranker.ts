import type { CoachInsight } from "../types/coach";
import { categoryBaseWeight, severityWeight } from "./helpers";

export function rankInsights(insights: CoachInsight[], limit = 5): CoachInsight[] {
  return [...insights]
    .map((insight) => ({
      ...insight,
      weight: (insight.weight ?? 1) * severityWeight(insight.severity) * insight.confidence * categoryBaseWeight(insight.category)
    }))
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, limit);
}
