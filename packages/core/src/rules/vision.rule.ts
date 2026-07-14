import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { insight } from "./helpers";

export function detectLowVision(ctx: MatchContext): CoachInsight[] {
  const durationMin = Math.max(1, ctx.aggregate.durationSec / 60);
  const visionScore = ctx.aggregate.visionScore;
  if (typeof visionScore !== "number" || ctx.aggregate.durationSec < 15 * 60) return [];

  const visionPerMin = visionScore / durationMin;
  const expected = ctx.player.role === "support" ? 1.7 : ctx.player.role === "jungle" ? 1.1 : 0.55;
  if (visionPerMin >= expected) return [];

  return [
    insight({
      category: "vision",
      severity: visionPerMin < expected * 0.55 ? "high" : "medium",
      confidence: 0.68,
      title: "Vision activity was low for the game length",
      evidence: [`Vision score: ${visionScore}`, `Vision/min: ${visionPerMin.toFixed(2)}`, `Role target estimate: ${expected.toFixed(2)}/min`],
      affectedTimestamps: [],
      ruleSource: "detectLowVision",
      recommendedFocus:
        "Before pushing past river or setting up objectives, place vision first. Build a habit of pairing every recall with a control ward when possible."
    })
  ];
}
