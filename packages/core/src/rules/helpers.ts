import { nanoid } from "nanoid";
import type { CoachInsight, InsightCategory, InsightSeverity } from "../types/coach";

export function insight(input: Omit<CoachInsight, "id">): CoachInsight {
  return { id: nanoid(10), ...input };
}

export function severityWeight(severity: InsightSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function categoryBaseWeight(category: InsightCategory): number {
  switch (category) {
    case "laning":
    case "positioning":
    case "objective_control":
      return 1.2;
    case "vision":
      return 0.95;
    case "cs":
      return 0.85;
    case "jungle_tempo":
    case "support_roaming":
      return 1.1;
    default:
      return 1;
  }
}
