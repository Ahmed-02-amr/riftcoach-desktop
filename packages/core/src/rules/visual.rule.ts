import type { CoachInsight } from "../types/coach";
import type { MatchContext } from "../types/game";
import { formatTime } from "../utils/time";
import { insight } from "./helpers";

export function insightsFromVisualObservations(ctx: MatchContext): CoachInsight[] {
  const observations = ctx.visualObservations ?? [];
  const highConfidence = observations.filter((obs) => obs.confidence >= 0.65);
  if (highConfidence.length === 0) return [];

  return highConfidence.slice(0, 3).map((obs) =>
    insight({
      category: "visual_review",
      severity: obs.confidence >= 0.82 ? "high" : "medium",
      confidence: obs.confidence,
      title: obs.title,
      evidence: [`${formatTime(obs.timestampSec)}: ${obs.details}`, ...obs.evidence],
      affectedTimestamps: [obs.timestampSec],
      ruleSource: "insightsFromVisualObservations",
      recommendedFocus:
        obs.category === "positioning"
          ? "Use the frame as a replay bookmark and check whether your camera/position exposed you before teammates were ready."
          : "Use this visual bookmark during review to connect the map state to the decision you made."
    })
  );
}
