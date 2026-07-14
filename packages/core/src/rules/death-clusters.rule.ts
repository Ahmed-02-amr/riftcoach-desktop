import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { formatTime } from "../utils/time";
import { insight } from "./helpers";

export function detectDeathClusters(ctx: MatchContext): CoachInsight[] {
  const deaths = ctx.aggregate.deathTimestamps;
  if (deaths.length < 2) return [];
  const clusters: number[][] = [];

  for (const death of deaths) {
    const existing = clusters.find((cluster) => death - cluster[0]! <= 4 * 60);
    if (existing) existing.push(death);
    else clusters.push([death]);
  }

  const worst = clusters.sort((a, b) => b.length - a.length)[0];
  if (!worst || worst.length < 2) return [];

  return [
    insight({
      category: "positioning",
      severity: worst.length >= 3 ? "high" : "medium",
      confidence: 0.71,
      title: "Deaths happened in a short repeated window",
      evidence: [`${worst.length} deaths between ${formatTime(worst[0]!)} and ${formatTime(worst.at(-1)!)}.`],
      affectedTimestamps: worst,
      ruleSource: "detectDeathClusters",
      recommendedFocus:
        "After a death, play the next two minutes slower. Re-enter the map through safe waves and vision rather than immediately contesting the same area."
    })
  ];
}
