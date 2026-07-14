export interface ScreenshotFrame {
  id: string;
  sessionId: string;
  timestampSec: number;
  capturedAtIso: string;
  filePath: string;
  width?: number;
  height?: number;
  source: "screen-capture" | "vod-frame" | "rofl-replay-frame";
}

export interface VodImportOptions {
  videoStartOffsetSec?: number;
  maxFrames?: number;
}

export interface VodImportResult {
  id: string;
  sessionId: string;
  filePath: string;
  importedAtIso: string;
  videoStartOffsetSec: number;
  durationSec?: number;
  frameCount: number;
  observationCount: number;
  warnings: string[];
}

export type VisualEvidenceKind = "bookmark" | "pixel-scan" | "verified" | "telemetry";

export interface VisualObservation {
  id: string;
  sessionId: string;
  frameId?: string;
  timestampSec: number;
  category: "positioning" | "vision" | "wave" | "objective_setup" | "death_context" | "unknown";
  confidence: number;
  title: string;
  details: string;
  evidence: string[];
  /**
   * Describes what the observation can actually prove. A bookmark only proves
   * that a frame exists at a timestamp; it does not prove what is visible in it.
   */
  evidenceKind?: VisualEvidenceKind;
}

export function getVisualEvidenceKind(observation: VisualObservation): VisualEvidenceKind {
  if (observation.evidenceKind) return observation.evidenceKind;

  const text = `${observation.title}\n${observation.details}`;
  if (/telemetry parsed|metadata parsed|metadata envelope/i.test(text)) return "telemetry";
  if (/^local .+ scan$/i.test(observation.title) || /minimap visibility check|local pixel scan|not object detection/i.test(text)) {
    return "pixel-scan";
  }
  if (
    /bookmark|\b(?:vod|rofl|replay) .*(?:frame|checkpoint)|(?:frame|checkpoint) .*(?:vod|replay)/i.test(text) ||
    /frame (?:was )?(?:captured|extracted)/i.test(text)
  ) {
    return "bookmark";
  }
  return "verified";
}

export function isVerifiedVisualObservation(observation: VisualObservation): boolean {
  return getVisualEvidenceKind(observation) === "verified";
}
