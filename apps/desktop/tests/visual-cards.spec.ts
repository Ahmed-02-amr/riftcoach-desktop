import { describe, expect, it } from "vitest";
import type { ScreenshotFrame, VisualObservation } from "../src/renderer/types";
import { buildVisualCards } from "../src/renderer/visual-cards";

const screenFrame: ScreenshotFrame = {
  id: "screen-304",
  sessionId: "session-1",
  timestampSec: 304,
  capturedAtIso: "2026-07-14T18:25:04.000Z",
  filePath: "C:/screenshots/screen-304.png",
  source: "screen-capture"
};

function observation(overrides: Partial<VisualObservation>): VisualObservation {
  return {
    id: "bookmark-300",
    sessionId: "session-1",
    frameId: "missing-black-vod-frame",
    timestampSec: 300,
    category: "wave",
    confidence: 0.5,
    title: "Laning checkpoint VOD frame",
    details: "Frame extracted at 5:00 as a review checkpoint.",
    evidence: [],
    ...overrides
  };
}

describe("buildVisualCards", () => {
  it("replaces a missing black VOD frame with one healthy screenshot and hides duplicate pixel scans", () => {
    const observations = [
      observation({}),
      observation({ id: "scan", title: "Local wave scan", details: "Local pixel scan; not object detection." }),
      observation({ id: "minimap", title: "Minimap visibility check", category: "vision" })
    ];

    const cards = buildVisualCards([screenFrame], observations);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.frame.id).toBe("screen-304");
    expect(cards[0]?.title).toBe("Automatic match screenshot");
    expect(cards[0]?.details).toContain("manual visual reference");
    expect(cards[0]?.verified).toBe(false);
  });

  it("preserves explicitly verified observations when their frame is available", () => {
    const verified = observation({
      id: "verified",
      frameId: screenFrame.id,
      title: "Verified positioning issue",
      details: "The player verified this positioning note.",
      evidenceKind: "verified"
    });

    const cards = buildVisualCards([screenFrame], [verified]);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe("Verified positioning issue");
    expect(cards[0]?.details).toBe("The player verified this positioning note.");
    expect(cards[0]?.verified).toBe(true);
  });
});
