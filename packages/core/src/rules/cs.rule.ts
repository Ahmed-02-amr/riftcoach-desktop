import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import type { PlayerRole } from "../types/settings";
import { insight } from "./helpers";

const EXPECTED_CS_AT_10_BY_ROLE: Record<PlayerRole, number> = {
  top: 62,
  jungle: 52,
  mid: 65,
  adc: 68,
  support: 8,
  unknown: 60
};

function rankAdjustment(rank?: string): number {
  const normalized = rank?.toLowerCase() ?? "";
  if (normalized.includes("iron")) return -18;
  if (normalized.includes("bronze")) return -14;
  if (normalized.includes("silver")) return -9;
  if (normalized.includes("gold")) return -5;
  if (normalized.includes("platinum")) return 0;
  if (normalized.includes("emerald")) return 3;
  if (normalized.includes("diamond")) return 6;
  if (normalized.includes("master") || normalized.includes("grandmaster") || normalized.includes("challenger")) return 10;
  return -7;
}

export function detectLowCs(ctx: MatchContext): CoachInsight[] {
  if (ctx.player.role === "support") return [];
  const csAt10 = ctx.aggregate.csAt10;
  if (typeof csAt10 !== "number") return [];

  const expected = EXPECTED_CS_AT_10_BY_ROLE[ctx.player.role] + rankAdjustment(ctx.player.rank);
  const delta = expected - csAt10;
  if (delta < 12) return [];

  return [
    insight({
      category: "cs",
      severity: delta >= 22 ? "high" : "medium",
      confidence: 0.8,
      title: "CS was below your role target at 10 minutes",
      evidence: [`CS at 10: ${csAt10}`, `Target estimate: ${Math.round(expected)}`],
      affectedTimestamps: [10 * 60],
      ruleSource: "detectLowCs",
      recommendedFocus:
        "For the next few games, prioritize catching safe waves over low-probability roams or fights before your first completed item."
    })
  ];
}
