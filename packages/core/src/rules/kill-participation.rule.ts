import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { insight } from "./helpers";

export function detectLowKillParticipation(ctx: MatchContext): CoachInsight[] {
  const teamKills = ctx.aggregate.teamKills;
  if (!teamKills || teamKills < 6 || ctx.player.role === "top") return [];
  const kp = (ctx.aggregate.kills + ctx.aggregate.assists) / teamKills;
  const threshold = ctx.player.role === "jungle" || ctx.player.role === "support" ? 0.45 : 0.35;
  if (kp >= threshold) return [];

  return [
    insight({
      category: ctx.player.role === "jungle" ? "jungle_tempo" : "macro",
      severity: kp < threshold - 0.15 ? "high" : "medium",
      confidence: 0.62,
      title: "Low involvement in team kills",
      evidence: [`Kill participation: ${(kp * 100).toFixed(0)}%`, `Team kills observed: ${teamKills}`],
      affectedTimestamps: [],
      ruleSource: "detectLowKillParticipation",
      recommendedFocus:
        "Look for cleaner timing windows to join fights: after pushing a wave, after a successful reset, or before major objective setup."
    })
  ];
}
