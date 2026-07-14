import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { insight } from "./helpers";

const STARTER_OR_CONSUMABLE_HINTS = ["potion", "ward", "trinket", "dorans", "doran's", "support item"];

export function detectItemizationGaps(ctx: MatchContext): CoachInsight[] {
  if (ctx.aggregate.durationSec < 18 * 60) return [];
  const finalItems = ctx.aggregate.itemNamesFinal.map((item) => item.toLowerCase());
  const meaningfulItems = finalItems.filter((name) => !STARTER_OR_CONSUMABLE_HINTS.some((hint) => name.includes(hint)));
  if (meaningfulItems.length >= 2) return [];

  return [
    insight({
      category: "itemization",
      severity: "medium",
      confidence: 0.5,
      title: "Item progression looked delayed",
      evidence: [`Final observed items: ${ctx.aggregate.itemNamesFinal.join(", ") || "none"}`],
      affectedTimestamps: [],
      ruleSource: "detectItemizationGaps",
      recommendedFocus:
        "Review recall timing and death timing. Delayed first or second item often comes from staying on the map too long with spendable gold or dying before reset windows."
    })
  ];
}
