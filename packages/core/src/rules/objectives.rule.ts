import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { formatTime } from "../utils/time";
import { insight } from "./helpers";

const OBJECTIVE_TYPES = new Set(["dragon_kill", "baron_kill", "rift_herald_kill"]);

export function detectDeathsBeforeObjectives(ctx: MatchContext): CoachInsight[] {
  const objectives = ctx.events.filter((event) => OBJECTIVE_TYPES.has(event.type));
  const deaths = ctx.aggregate.deathTimestamps;
  const badDeaths = deaths.filter((deathTime) => objectives.some((obj) => obj.timestampSec >= deathTime && obj.timestampSec - deathTime <= 60));
  if (badDeaths.length === 0) return [];

  return [
    insight({
      category: "objective_control",
      severity: badDeaths.length >= 2 ? "high" : "medium",
      confidence: 0.74,
      title: "Death timing hurt objective setup",
      evidence: badDeaths.map((time) => `Death at ${formatTime(time)} within 60 seconds before a major objective event`),
      affectedTimestamps: badDeaths,
      ruleSource: "detectDeathsBeforeObjectives",
      recommendedFocus:
        "At 45–60 seconds before dragon, Herald, or Baron, stop taking isolated fights and move into setup mode: reset, group, ward, and protect tempo."
    })
  ];
}
