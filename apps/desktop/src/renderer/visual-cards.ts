import type { ScreenshotFrame, VisualObservation } from "./types";

export interface VisualCard {
  frame: ScreenshotFrame;
  timestampSec: number;
  category: VisualObservation["category"];
  title: string;
  details: string;
  verified: boolean;
}

const MAX_VISUAL_CARDS = 8;
const FALLBACK_WINDOW_SEC = 75;

export function buildVisualCards(frames: ScreenshotFrame[], observations: VisualObservation[]): VisualCard[] {
  const sortedFrames = [...frames].sort((a, b) => a.timestampSec - b.timestampSec);
  const screenFrames = sortedFrames.filter((frame) => frame.source === "screen-capture");
  const framesById = new Map(sortedFrames.map((frame) => [frame.id, frame]));
  const usedFrameIds = new Set<string>();
  const cards: VisualCard[] = [];

  const displayObservations = observations
    .filter((observation) => observation.frameId && isDisplayObservation(observation))
    .sort((a, b) => a.timestampSec - b.timestampSec);

  for (const observation of displayObservations) {
    if (cards.length >= MAX_VISUAL_CARDS) break;

    const directFrame = observation.frameId ? framesById.get(observation.frameId) : undefined;
    const frame = directFrame ?? findNearestFrame(screenFrames, observation.timestampSec, FALLBACK_WINDOW_SEC, usedFrameIds);
    if (!frame || usedFrameIds.has(frame.id)) continue;

    usedFrameIds.add(frame.id);
    const verified = observationKind(observation) === "verified" && Boolean(directFrame);
    cards.push({
      frame,
      timestampSec: frame.timestampSec,
      category: observation.category,
      title: verified ? observation.title : frame.source === "screen-capture" ? "Automatic match screenshot" : observation.title,
      details: verified
        ? observation.details
        : manualReviewCopy(frame, observation.timestampSec, Boolean(directFrame)),
      verified
    });
  }

  const latestTimestamp = sortedFrames.at(-1)?.timestampSec ?? 0;
  const checkpoints = [...new Set([300, 600, 900, latestTimestamp].filter((timestamp) => timestamp > 0))];
  for (const checkpoint of checkpoints) {
    if (cards.length >= MAX_VISUAL_CARDS) break;
    const frame = findNearestFrame(screenFrames, checkpoint, FALLBACK_WINDOW_SEC, usedFrameIds);
    if (!frame) continue;
    usedFrameIds.add(frame.id);
    cards.push({
      frame,
      timestampSec: frame.timestampSec,
      category: "unknown",
      title: "Automatic match screenshot",
      details: manualReviewCopy(frame, checkpoint, false),
      verified: false
    });
  }

  return cards.sort((a, b) => a.timestampSec - b.timestampSec);
}

function isDisplayObservation(observation: VisualObservation): boolean {
  const kind = observationKind(observation);
  return kind === "bookmark" || kind === "verified";
}

function observationKind(observation: VisualObservation): NonNullable<VisualObservation["evidenceKind"]> {
  if (observation.evidenceKind) return observation.evidenceKind;
  const text = `${observation.title}\n${observation.details}`;
  if (/^local .+ scan$/i.test(observation.title) || /minimap visibility check|local pixel scan|not object detection/i.test(text)) {
    return "pixel-scan";
  }
  if (/telemetry parsed|metadata parsed|metadata envelope/i.test(text)) return "telemetry";
  if (/bookmark|\b(?:vod|rofl|replay) .*(?:frame|checkpoint)|frame (?:was )?(?:captured|extracted)/i.test(text)) {
    return "bookmark";
  }
  return "verified";
}

function findNearestFrame(
  frames: ScreenshotFrame[],
  timestampSec: number,
  toleranceSec: number,
  excludedIds: Set<string>
): ScreenshotFrame | undefined {
  let nearest: ScreenshotFrame | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (excludedIds.has(frame.id)) continue;
    const distance = Math.abs(frame.timestampSec - timestampSec);
    if (distance <= toleranceSec && distance < nearestDistance) {
      nearest = frame;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function manualReviewCopy(frame: ScreenshotFrame, markerTimestampSec: number, directFrame: boolean): string {
  const relationship = directFrame
    ? "captured at this review marker"
    : `captured near the ${formatShortDuration(markerTimestampSec)} review marker`;
  return `This frame was ${relationship}. Use it as a manual visual reference; RiftCoach has not semantically graded its contents.`;
}

function formatShortDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
