import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { formatTime } from "../utils/time";
import { insight } from "./helpers";

export function detectEarlyDeaths(ctx: MatchContext): CoachInsight[] {
  const earlyDeaths = ctx.aggregate.deathTimestamps.filter((timestamp) => timestamp <= 10 * 60);
  if (earlyDeaths.length === 0) return [];

  const severity = earlyDeaths.length >= 2 ? "high" : "medium";
  return [
    insight({
      category: "laning",
      severity,
      confidence: earlyDeaths.length >= 2 ? 0.92 : 0.72,
      title: earlyDeaths.length >= 2 ? "Multiple deaths before 10 minutes" : "Early death before 10 minutes",
      evidence: earlyDeaths.map((timestamp) => `Death at ${formatTime(timestamp)}`),
      affectedTimestamps: earlyDeaths,
      ruleSource: "detectEarlyDeaths",
      recommendedFocus:
        "For the next review block, treat the first 10 minutes as survival-first. Give up low-value CS rather than taking risky trades without vision or cooldown advantage."
    })
  ];
}
