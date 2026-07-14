export const CoachReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviewType", "summary", "mainMistake", "positiveHabit", "timelineNotes", "nextGameDrill", "warnings"],
  properties: {
    reviewType: { type: "string", enum: ["coaching", "casual_mode"] },
    summary: { type: "string", minLength: 1 },
    mainMistake: {
      type: "object",
      additionalProperties: false,
      required: ["title", "explanation", "evidence", "whyItMatters"],
      properties: {
        title: { type: "string" },
        explanation: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
        whyItMatters: { type: "string" }
      }
    },
    positiveHabit: {
      type: "object",
      additionalProperties: false,
      required: ["title", "explanation"],
      properties: {
        title: { type: "string" },
        explanation: { type: "string" }
      }
    },
    timelineNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestampSec", "title", "note"],
        properties: {
          timestampSec: { type: "number" },
          title: { type: "string" },
          note: { type: "string" }
        }
      }
    },
    nextGameDrill: {
      type: "object",
      additionalProperties: false,
      required: ["title", "steps", "successMetric", "duration"],
      properties: {
        title: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        successMetric: { type: "string" },
        duration: { type: "string", enum: ["next_game", "next_3_games", "next_5_games"] }
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  }
} as const;
