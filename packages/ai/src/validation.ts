import Ajv from "ajv";
import { nanoid } from "nanoid";
import type { CoachReport, CoachReportInput } from "@riftcoach/core";
import { CoachReportJsonSchema, isCasualReviewMode } from "@riftcoach/core";

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(CoachReportJsonSchema as any);

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model response did not contain valid JSON.");
  }
}

export function validateCoachReportPayload(payload: unknown): asserts payload is Omit<CoachReport, "id" | "sessionId" | "provider" | "createdAtIso"> {
  if (!validate(payload)) {
    const details = validate.errors?.map((err) => `${err.instancePath} ${err.message}`).join("; ") ?? "unknown schema error";
    throw new Error(`Coach report failed schema validation: ${details}`);
  }
}

export function withInferredReviewType(payload: unknown, input: CoachReportInput): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || "reviewType" in payload) return payload;
  return {
    reviewType: isCasualReviewMode(input.match.game) ? "casual_mode" : "coaching",
    ...payload
  };
}

export function attachReportMetadata(params: {
  payload: unknown;
  sessionId: string;
  provider: CoachReport["provider"];
  model?: string;
}): CoachReport {
  validateCoachReportPayload(params.payload);
  return {
    id: nanoid(12),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    createdAtIso: new Date().toISOString(),
    ...(params.payload as any)
  };
}
