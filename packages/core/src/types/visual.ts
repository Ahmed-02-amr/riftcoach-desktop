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
}
