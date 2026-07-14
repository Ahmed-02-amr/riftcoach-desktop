import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { insight } from "./helpers";

export function detectJungleTempo(ctx: MatchContext): CoachInsight[] {
  if (ctx.player.role !== "jungle") return [];
  const earlyParticipation = ctx.events.some((event) => {
    if (event.type !== "champion_kill" || event.timestampSec > 8 * 60) return false;
    const name = ctx.player.summonerName?.toLowerCase() ?? ctx.player.riotId?.toLowerCase();
    if (!name) return false;
    return event.actorName?.toLowerCase() === name || event.assistingParticipantNames?.some((a) => a.toLowerCase() === name);
  });
  if (earlyParticipation) return [];

  return [
    insight({
      category: "jungle_tempo",
      severity: "medium",
      confidence: 0.58,
      title: "Low early jungle map impact detected",
      evidence: ["No observed kill or assist participation before 8:00."],
      affectedTimestamps: [8 * 60],
      ruleSource: "detectJungleTempo",
      recommendedFocus:
        "Review first clear tempo and first recall timing. Your next goal is to arrive to first scuttle/objective windows with a clear plan, not react late."
    })
  ];
}
