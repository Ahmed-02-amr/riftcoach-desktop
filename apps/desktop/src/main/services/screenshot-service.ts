import { desktopCapturer } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { ScreenshotFrame } from "@riftcoach/core";

interface ScreenshotServiceOptions {
  userDataPath: string;
}

export class ScreenshotService {
  private readonly directory: string;

  constructor(options: ScreenshotServiceOptions) {
    this.directory = join(options.userDataPath, "screenshots");
  }

  async capturePrimaryScreen(
    sessionId: string,
    timestampSec: number,
    frameSource: ScreenshotFrame["source"] = "screen-capture"
  ): Promise<ScreenshotFrame | undefined> {
    await mkdir(this.directory, { recursive: true });
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    const source = sources[0];
    if (!source || source.thumbnail.isEmpty()) return undefined;

    const id = nanoid(12);
    const capturedAtIso = new Date().toISOString();
    const filePath = join(this.directory, `${sessionId}-${Math.round(timestampSec)}-${id}.png`);
    const png = source.thumbnail.toPNG();
    await writeFile(filePath, png);
    const size = source.thumbnail.getSize();

    return {
      id,
      sessionId,
      timestampSec,
      capturedAtIso,
      filePath,
      width: size.width,
      height: size.height,
      source: frameSource
    };
  }
}
