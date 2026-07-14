import { nanoid } from "nanoid";
import type { CoachReport } from "../types/coach";
import type { MatchContext } from "../types/game";
import { nowIso } from "../utils/time";

export type TrainingGoalType = "no_early_deaths" | "cs_at_10" | "vision_before_pressure" | "objective_setup" | "custom";

export interface TrainingGoal {
  id: string;
  type: TrainingGoalType;
  title: string;
  description: string;
  targetValue?: number;
  createdAtIso: string;
  active: boolean;
}

export interface GoalResult {
  goalId: string;
  sessionId: string;
  passed: boolean;
  value?: number;
  note: string;
  evaluatedAtIso: string;
}

export function goalFromReport(report: CoachReport): TrainingGoal {
  if (report.reviewType === "casual_mode") throw new Error("Casual-mode reports do not contain training drills.");

  const title = report.nextGameDrill.title;
  const lower = title.toLowerCase();
  const type: TrainingGoalType = lower.includes("death")
    ? "no_early_deaths"
    : lower.includes("cs")
      ? "cs_at_10"
      : lower.includes("ward") || lower.includes("vision")
        ? "vision_before_pressure"
        : lower.includes("objective")
          ? "objective_setup"
          : "custom";

  return {
    id: nanoid(12),
    type,
    title,
    description: report.nextGameDrill.steps.join(" "),
    targetValue: type === "cs_at_10" ? 65 : type === "no_early_deaths" ? 0 : undefined,
    createdAtIso: nowIso(),
    active: true
  };
}

export function evaluateGoal(goal: TrainingGoal, match: MatchContext): GoalResult {
  switch (goal.type) {
    case "no_early_deaths": {
      const deaths = match.aggregate.deathsBefore10;
      return {
        goalId: goal.id,
        sessionId: match.sessionId,
        passed: deaths <= (goal.targetValue ?? 0),
        value: deaths,
        note: deaths === 0 ? "Passed: no deaths before 10 minutes." : `Failed: ${deaths} death(s) before 10 minutes.`,
        evaluatedAtIso: nowIso()
      };
    }
    case "cs_at_10": {
      const value = match.aggregate.csAt10 ?? 0;
      const target = goal.targetValue ?? 65;
      return {
        goalId: goal.id,
        sessionId: match.sessionId,
        passed: value >= target,
        value,
        note: value >= target ? `Passed: ${value} CS at 10.` : `Failed: ${value}/${target} CS at 10.`,
        evaluatedAtIso: nowIso()
      };
    }
    default:
      return {
        goalId: goal.id,
        sessionId: match.sessionId,
        passed: false,
        note: "Manual review required for this goal type.",
        evaluatedAtIso: nowIso()
      };
  }
}
