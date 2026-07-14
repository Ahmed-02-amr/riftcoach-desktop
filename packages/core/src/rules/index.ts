import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { detectLowCs } from "./cs.rule";
import { detectDeathClusters } from "./death-clusters.rule";
import { detectEarlyDeaths } from "./early-deaths.rule";
import { detectItemizationGaps } from "./itemization.rule";
import { detectJungleTempo } from "./jungle-tempo.rule";
import { detectLowKillParticipation } from "./kill-participation.rule";
import { detectDeathsBeforeObjectives } from "./objectives.rule";
import { rankInsights } from "./insight-ranker";
import { detectLowVision } from "./vision.rule";
import { insightsFromVisualObservations } from "./visual.rule";

export { rankInsights } from "./insight-ranker";
export { insightsFromVisualObservations } from "./visual.rule";

export function runExpertRules(ctx: MatchContext): CoachInsight[] {
  const insights: CoachInsight[] = [
    ...detectEarlyDeaths(ctx),
    ...detectLowCs(ctx),
    ...detectLowVision(ctx),
    ...detectDeathsBeforeObjectives(ctx),
    ...detectDeathClusters(ctx),
    ...detectLowKillParticipation(ctx),
    ...detectJungleTempo(ctx),
    ...detectItemizationGaps(ctx),
    ...insightsFromVisualObservations(ctx)
  ];

  return rankInsights(insights, 5);
}

export function runVisualReviewRules(ctx: MatchContext): CoachInsight[] {
  return rankInsights(insightsFromVisualObservations(ctx), 5);
}
