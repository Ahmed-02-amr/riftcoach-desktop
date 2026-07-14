import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { nativeImage } from "electron";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import { formatTime, type MatchContext, type NormalizedEvent, type ScreenshotFrame, type VisualObservation, type VodImportOptions, type VodImportResult } from "@riftcoach/core";
import { VisualRepository } from "@riftcoach/storage";

interface VisualReviewServiceOptions {
  db: Database.Database;
  userDataPath: string;
}

interface PlannedVodFrame {
  timestampSec: number;
  videoTimestampSec: number;
  category: VisualObservation["category"];
  confidence: number;
  title: string;
  details: string;
  priority: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface RegionStats {
  brightness: number;
  contrast: number;
  saturation: number;
  activity: number;
  darkShare: number;
  brightShare: number;
}

const requireFromHere = createRequire(__filename);
const MAJOR_OBJECTIVE_TYPES = new Set<NormalizedEvent["type"]>(["dragon_kill", "baron_kill", "rift_herald_kill", "turret_kill", "inhibitor_kill"]);

export class VisualReviewService {
  private readonly repo: VisualRepository;
  private readonly vodDirectory: string;
  private readonly screenshotDirectory: string;

  constructor(options: VisualReviewServiceOptions) {
    this.repo = new VisualRepository(options.db);
    this.vodDirectory = join(options.userDataPath, "vod-frames");
    this.screenshotDirectory = join(options.userDataPath, "screenshots");
  }

  async createBookmarkObservations(match: MatchContext): Promise<VisualObservation[]> {
    const frames = this.repo.listFrames(match.sessionId);
    const existing = this.repo.listObservations(match.sessionId);
    const existingKeys = new Set(existing.map((obs) => `${obs.frameId ?? ""}:${obs.category}:${Math.round(obs.timestampSec)}`));
    const observations: VisualObservation[] = [];

    for (const deathTime of match.aggregate.deathTimestamps) {
      const frame = nearestFrame(frames, deathTime, 20);
      if (!frame) continue;
      const key = `${frame.id}:death_context:${Math.round(frame.timestampSec)}`;
      if (existingKeys.has(key)) continue;
      const obs: VisualObservation = {
        id: nanoid(12),
        sessionId: match.sessionId,
        frameId: frame.id,
        timestampSec: frame.timestampSec,
        category: "death_context",
        confidence: 0.66,
        title: frame.source === "vod-frame" ? "VOD bookmark near death" : "Visual bookmark near death",
        details:
          "A visual frame was captured close to one of your deaths. Use it during review to inspect positioning, wave state, and nearby teammates before the death.",
        evidence: [`Frame: ${frame.filePath}`]
      };
      this.repo.saveObservation(obs);
      observations.push(obs);
      existingKeys.add(key);
    }

    return observations;
  }

  async importVodForMatch(match: MatchContext, filePath: string, options: VodImportOptions = {}): Promise<VodImportResult> {
    const vodPath = resolve(filePath);
    if (!existsSync(vodPath)) throw new Error(`VOD file not found: ${filePath}`);

    await mkdir(this.vodDirectory, { recursive: true });
    const warnings: string[] = [];
    const videoStartOffsetSec = cleanNumber(options.videoStartOffsetSec, 0);
    const maxFrames = Math.max(4, Math.min(40, Math.round(options.maxFrames ?? 24)));
    const durationSec = await this.probeDuration(vodPath).catch((error) => {
      warnings.push(`Could not read VOD duration with ffprobe: ${formatError(error)}`);
      return undefined;
    });
    const plan = planVodFrames({ match, durationSec, videoStartOffsetSec, maxFrames, warnings });

    if (plan.length === 0) {
      throw new Error("No usable VOD timestamps were found. Try changing the VOD offset seconds so game time lines up with the recording.");
    }

    const frames: ScreenshotFrame[] = [];
    const observations: VisualObservation[] = [];

    for (const item of plan) {
      const frameId = nanoid(12);
      const outputPath = join(
        this.vodDirectory,
        `${match.sessionId}-${Math.round(item.timestampSec)}-${slug(item.title)}-${frameId}.jpg`
      );

      try {
        await this.extractFrame(vodPath, outputPath, item.videoTimestampSec);
        const size = readImageSize(outputPath);
        const frame: ScreenshotFrame = {
          id: frameId,
          sessionId: match.sessionId,
          timestampSec: item.timestampSec,
          capturedAtIso: new Date().toISOString(),
          filePath: outputPath,
          width: size?.width,
          height: size?.height,
          source: "vod-frame"
        };
        const obs: VisualObservation = {
          id: nanoid(12),
          sessionId: match.sessionId,
          frameId,
          timestampSec: item.timestampSec,
          category: item.category,
          confidence: item.confidence,
          title: item.title,
          details: item.details,
          evidence: [`VOD frame: ${outputPath}`, `Game time: ${formatTime(item.timestampSec)}`, `Video time: ${formatTime(item.videoTimestampSec)}`]
        };
        this.repo.saveFrame(frame);
        this.repo.saveObservation(obs);
        frames.push(frame);
        observations.push(obs);
        try {
          const localObservations = this.analyzeFrame(frame, item);
          for (const localObservation of localObservations) {
            this.repo.saveObservation(localObservation);
            observations.push(localObservation);
          }
        } catch (error) {
          warnings.push(`Local frame analysis skipped for ${formatTime(item.videoTimestampSec)}: ${formatError(error)}`);
        }
      } catch (error) {
        warnings.push(`Could not extract ${formatTime(item.videoTimestampSec)} (${item.title}): ${formatError(error)}`);
      }
    }

    if (frames.length === 0) {
      throw new Error(`VOD import failed before any frames were extracted. ${warnings.at(-1) ?? ""}`.trim());
    }

    const result: VodImportResult = {
      id: nanoid(12),
      sessionId: match.sessionId,
      filePath: vodPath,
      importedAtIso: new Date().toISOString(),
      videoStartOffsetSec,
      durationSec,
      frameCount: frames.length,
      observationCount: observations.length,
      warnings
    };
    this.repo.saveVodImport(result);
    return result;
  }

  listFrames(sessionId: string): ScreenshotFrame[] {
    return this.repo.listFrames(sessionId);
  }

  listObservations(sessionId: string): VisualObservation[] {
    return this.repo.listObservations(sessionId);
  }

  listVodImports(sessionId: string): VodImportResult[] {
    return this.repo.listVodImports(sessionId);
  }

  saveEvidenceObservation(input: {
    sessionId: string;
    timestampSec: number;
    title: string;
    details: string;
    evidence: string[];
    category?: VisualObservation["category"];
    confidence?: number;
  }): VisualObservation {
    const observation: VisualObservation = {
      id: nanoid(12),
      sessionId: input.sessionId,
      timestampSec: input.timestampSec,
      category: input.category ?? "unknown",
      confidence: input.confidence ?? 0.9,
      title: input.title,
      details: input.details,
      evidence: input.evidence
    };
    this.repo.saveObservation(observation);
    return observation;
  }

  saveReplayFrame(frame: ScreenshotFrame, input?: {
    title?: string;
    details?: string;
    category?: VisualObservation["category"];
    confidence?: number;
    evidence?: string[];
  }): VisualObservation[] {
    this.repo.saveFrame(frame);
    const category = input?.category ?? "unknown";
    const obs: VisualObservation = {
      id: nanoid(12),
      sessionId: frame.sessionId,
      frameId: frame.id,
      timestampSec: frame.timestampSec,
      category,
      confidence: input?.confidence ?? 0.62,
      title: input?.title ?? "ROFL replay frame",
      details:
        input?.details ??
        "Frame captured from the League replay client after seeking the ROFL replay. Use it to inspect visible map state, camera focus, and spacing.",
      evidence: input?.evidence ?? [`Replay frame: ${frame.filePath}`, `Replay time: ${formatTime(frame.timestampSec)}`]
    };
    this.repo.saveObservation(obs);

    const localObservations = this.analyzeFrame(frame, {
      timestampSec: frame.timestampSec,
      videoTimestampSec: frame.timestampSec,
      category,
      confidence: obs.confidence,
      title: obs.title,
      details: obs.details,
      priority: 6
    });
    for (const localObservation of localObservations) this.repo.saveObservation(localObservation);
    return [obs, ...localObservations];
  }

  saveVodImport(result: VodImportResult): void {
    this.repo.saveVodImport(result);
  }

  async probeVodDuration(filePath: string): Promise<number | undefined> {
    const vodPath = resolve(filePath);
    if (!existsSync(vodPath)) throw new Error(`VOD file not found: ${filePath}`);
    return this.probeDuration(vodPath);
  }

  async readFrameDataUrl(filePath: string): Promise<string> {
    const resolved = resolve(filePath);
    if (!isInside(resolved, this.vodDirectory) && !isInside(resolved, this.screenshotDirectory)) {
      throw new Error("Frame path is outside RiftCoach visual storage.");
    }
    const data = await readFile(resolved);
    return `data:${mimeForPath(resolved)};base64,${data.toString("base64")}`;
  }

  private async probeDuration(filePath: string): Promise<number | undefined> {
    const ffprobe = resolveFfprobePath();
    const result = await runCommand(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath], 15000);
    const parsed = JSON.parse(result.stdout) as { format?: { duration?: string } };
    const duration = Number(parsed.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }

  private async extractFrame(inputPath: string, outputPath: string, timestampSec: number): Promise<void> {
    const ffmpeg = resolveFfmpegPath();
    await runCommand(
      ffmpeg,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        timestampSec.toFixed(3),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2",
        "-q:v",
        "3",
        outputPath
      ],
      30000
    );
  }

  private analyzeFrame(frame: ScreenshotFrame, plan: PlannedVodFrame): VisualObservation[] {
    const image = nativeImage.createFromPath(frame.filePath);
    if (image.isEmpty()) return [];
    const size = image.getSize();
    if (size.width < 64 || size.height < 64) return [];

    const bitmap = image.toBitmap();
    const gameplay = scanRegion(bitmap, size.width, size.height, { x: 0.16, y: 0.12, width: 0.62, height: 0.58 });
    const minimap = scanRegion(bitmap, size.width, size.height, { x: 0.78, y: 0.66, width: 0.22, height: 0.32 });
    const hud = scanRegion(bitmap, size.width, size.height, { x: 0.18, y: 0.78, width: 0.58, height: 0.18 });
    const category = localScanCategory(plan.category, minimap);
    const confidence = plan.priority <= 3 ? 0.7 : 0.66;
    const observations: VisualObservation[] = [
      {
        id: nanoid(12),
        sessionId: frame.sessionId,
        frameId: frame.id,
        timestampSec: frame.timestampSec,
        category,
        confidence,
        title: `Local ${categoryLabel(category)} scan`,
        details:
          `Local pixel scan found ${levelLabel(gameplay.activity)} gameplay-region activity, ` +
          `${levelLabel(minimap.activity)} minimap-region activity, and ${levelLabel(hud.brightness)} HUD brightness. ` +
          `${focusForCategory(category)} Treat this as a replay bookmark, not object detection.`,
        evidence: [
          `Frame: ${frame.filePath}`,
          `Frame size: ${size.width}x${size.height}`,
          `Gameplay activity: ${score(gameplay.activity)}`,
          `Minimap activity: ${score(minimap.activity)}`,
          `HUD brightness: ${score(hud.brightness)}`
        ]
      }
    ];

    if (minimap.brightness < 0.16 && minimap.contrast < 0.055) {
      observations.push({
        id: nanoid(12),
        sessionId: frame.sessionId,
        frameId: frame.id,
        timestampSec: frame.timestampSec,
        category: "vision",
        confidence: 0.67,
        title: "Minimap visibility check",
        details:
          "The minimap region was unusually dark or low-contrast in this extracted frame. Confirm whether the recording crop/overlay hides map information, then use the bookmark to review map checks before the decision.",
        evidence: [
          `Frame: ${frame.filePath}`,
          `Minimap brightness: ${score(minimap.brightness)}`,
          `Minimap contrast: ${score(minimap.contrast)}`
        ]
      });
    }

    return observations;
  }
}

function planVodFrames(params: {
  match: MatchContext;
  durationSec?: number;
  videoStartOffsetSec: number;
  maxFrames: number;
  warnings: string[];
}): PlannedVodFrame[] {
  const { match, durationSec, videoStartOffsetSec, maxFrames, warnings } = params;
  const matchDuration = Math.max(match.aggregate.durationSec, ...match.snapshots.map((snapshot) => snapshot.timestampSec), 0);
  const candidates: Array<Omit<PlannedVodFrame, "videoTimestampSec">> = [];
  const add = (input: Omit<PlannedVodFrame, "videoTimestampSec">): void => {
    const timestampSec = Math.max(0, input.timestampSec);
    if (matchDuration > 0 && timestampSec > matchDuration + 30) return;
    candidates.push({ ...input, timestampSec });
  };

  for (const deathTime of match.aggregate.deathTimestamps) {
    add({
      timestampSec: Math.max(0, deathTime - 8),
      category: "death_context",
      confidence: 0.82,
      title: "Pre-death VOD frame",
      details: `Frame extracted about 8 seconds before the death at ${formatTime(deathTime)}. Check pathing, cursor/camera attention, wave state, and ally distance.`,
      priority: 1
    });
  }

  for (const event of match.events) {
    if (MAJOR_OBJECTIVE_TYPES.has(event.type)) {
      add({
        timestampSec: Math.max(0, event.timestampSec - 20),
        category: "objective_setup",
        confidence: 0.78,
        title: "Objective setup VOD frame",
        details: `Frame extracted before ${event.type.replace(/_/g, " ")} at ${formatTime(event.timestampSec)}. Check reset timing, river control, and whether you entered setup mode early enough.`,
        priority: 2
      });
    }
    if (event.type === "champion_kill" && playerInvolvedInEvent(match, event)) {
      add({
        timestampSec: Math.max(0, event.timestampSec - 5),
        category: eventNameMatchesPlayer(match, event.victimName) ? "death_context" : "positioning",
        confidence: 0.72,
        title: eventNameMatchesPlayer(match, event.victimName) ? "Fight before death VOD frame" : "Fight involvement VOD frame",
        details: `Frame extracted just before a player-involved fight at ${formatTime(event.timestampSec)}. Review spacing, target selection, and whether the fight started on your terms.`,
        priority: 3
      });
    }
  }

  const checkpointStep = matchDuration >= 25 * 60 ? 5 * 60 : 4 * 60;
  for (let timestampSec = 5 * 60; timestampSec <= matchDuration; timestampSec += checkpointStep) {
    add({
      timestampSec,
      category: timestampSec < 14 * 60 ? "wave" : "unknown",
      confidence: 0.62,
      title: timestampSec < 14 * 60 ? "Laning checkpoint VOD frame" : "Mid-game checkpoint VOD frame",
      details: `Frame extracted at ${formatTime(timestampSec)} as a review checkpoint. Use it to inspect wave state, camera position, minimap context, and item/recall timing.`,
      priority: 5
    });
  }

  if (candidates.length === 0 && durationSec && durationSec > 0) {
    const fallbackCount = Math.min(8, maxFrames);
    for (let index = 1; index <= fallbackCount; index += 1) {
      const videoTimestampSec = (durationSec * index) / (fallbackCount + 1);
      candidates.push({
        timestampSec: Math.max(0, videoTimestampSec - videoStartOffsetSec),
        category: "unknown",
        confidence: 0.5,
        title: "VOD sample frame",
        details: "Frame extracted from the VOD because no live telemetry timestamps were available for this review.",
        priority: 8
      });
    }
  }

  const withVideoTime = candidates
    .map((candidate) => ({ ...candidate, videoTimestampSec: candidate.timestampSec + videoStartOffsetSec }))
    .filter((candidate) => {
      const inRange = candidate.videoTimestampSec >= 0 && (!durationSec || candidate.videoTimestampSec <= durationSec);
      return inRange;
    });
  const skipped = candidates.length - withVideoTime.length;
  if (skipped > 0) warnings.push(`${skipped} planned VOD frame(s) were outside the video duration. Adjust VOD offset seconds if thumbnails look misaligned.`);

  return dedupePlannedFrames(withVideoTime, maxFrames);
}

function dedupePlannedFrames(frames: PlannedVodFrame[], limit: number): PlannedVodFrame[] {
  const chosen: PlannedVodFrame[] = [];
  for (const frame of [...frames].sort((a, b) => a.priority - b.priority || a.timestampSec - b.timestampSec)) {
    if (chosen.some((existing) => Math.abs(existing.timestampSec - frame.timestampSec) < 12)) continue;
    chosen.push(frame);
    if (chosen.length >= limit) break;
  }
  return chosen.sort((a, b) => a.timestampSec - b.timestampSec);
}

function playerInvolvedInEvent(match: MatchContext, event: NormalizedEvent): boolean {
  return (
    eventNameMatchesPlayer(match, event.actorName) ||
    eventNameMatchesPlayer(match, event.victimName) ||
    Boolean(event.assistingParticipantNames?.some((name) => eventNameMatchesPlayer(match, name)))
  );
}

function eventNameMatchesPlayer(match: MatchContext, name?: string): boolean {
  if (!name) return false;
  const normalized = normalizeName(name);
  const playerNames = [match.player.riotId, match.player.summonerName].map(normalizeName).filter(Boolean);
  return playerNames.includes(normalized) || normalized === normalizeName(match.player.championName);
}

function nearestFrame(frames: ScreenshotFrame[], timestampSec: number, toleranceSec: number): ScreenshotFrame | undefined {
  return frames
    .map((frame) => ({ frame, distance: Math.abs(frame.timestampSec - timestampSec) }))
    .filter((entry) => entry.distance <= toleranceSec)
    .sort((a, b) => a.distance - b.distance)[0]?.frame;
}

function readImageSize(filePath: string): { width: number; height: number } | undefined {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return undefined;
  const size = image.getSize();
  return size.width > 0 && size.height > 0 ? size : undefined;
}

function scanRegion(
  bitmap: Buffer,
  imageWidth: number,
  imageHeight: number,
  region: { x: number; y: number; width: number; height: number }
): RegionStats {
  const xStart = clampInt(Math.floor(imageWidth * region.x), 0, imageWidth - 1);
  const yStart = clampInt(Math.floor(imageHeight * region.y), 0, imageHeight - 1);
  const xEnd = clampInt(Math.ceil(imageWidth * (region.x + region.width)), xStart + 1, imageWidth);
  const yEnd = clampInt(Math.ceil(imageHeight * (region.y + region.height)), yStart + 1, imageHeight);
  const sampleStep = Math.max(1, Math.floor(Math.min(xEnd - xStart, yEnd - yStart) / 96));
  let count = 0;
  let sumBrightness = 0;
  let sumBrightnessSq = 0;
  let sumSaturation = 0;
  let darkCount = 0;
  let brightCount = 0;

  for (let y = yStart; y < yEnd; y += sampleStep) {
    for (let x = xStart; x < xEnd; x += sampleStep) {
      const offset = (y * imageWidth + x) * 4;
      if (offset + 2 >= bitmap.length) continue;
      const c1 = bitmap[offset] ?? 0;
      const c2 = bitmap[offset + 1] ?? 0;
      const c3 = bitmap[offset + 2] ?? 0;
      const brightness = (c1 + c2 + c3) / (255 * 3);
      const maxChannel = Math.max(c1, c2, c3);
      const minChannel = Math.min(c1, c2, c3);
      const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
      sumBrightness += brightness;
      sumBrightnessSq += brightness * brightness;
      sumSaturation += saturation;
      if (brightness < 0.12) darkCount += 1;
      if (brightness > 0.82) brightCount += 1;
      count += 1;
    }
  }

  if (count === 0) {
    return { brightness: 0, contrast: 0, saturation: 0, activity: 0, darkShare: 0, brightShare: 0 };
  }

  const brightness = sumBrightness / count;
  const variance = Math.max(0, sumBrightnessSq / count - brightness * brightness);
  const contrast = Math.sqrt(variance);
  const saturation = sumSaturation / count;
  return {
    brightness,
    contrast,
    saturation,
    activity: clamp(contrast * 1.45 + saturation * 0.7, 0, 1),
    darkShare: darkCount / count,
    brightShare: brightCount / count
  };
}

function localScanCategory(category: VisualObservation["category"], minimap: RegionStats): VisualObservation["category"] {
  if (category !== "unknown") return category;
  return minimap.activity < 0.18 ? "vision" : "positioning";
}

function categoryLabel(category: VisualObservation["category"]): string {
  return category.replace(/_/g, " ");
}

function focusForCategory(category: VisualObservation["category"]): string {
  switch (category) {
    case "death_context":
      return "Review spacing, escape routes, cooldown respect, and whether the death was already forced before the fight started.";
    case "objective_setup":
      return "Review reset timing, river entrance, teammate distance, and whether vision was placed before the objective window.";
    case "wave":
      return "Review lane state, last-hit pressure, recall timing, and whether the wave supports the next move.";
    case "vision":
      return "Review minimap visibility, ward coverage, and whether the decision had enough map information.";
    case "positioning":
      return "Review camera focus, spacing, ally distance, and whether the player walked into threat before the play was ready.";
    case "unknown":
    default:
      return "Review the visible game state and choose the decision pattern that most clearly repeats.";
  }
}

function levelLabel(value: number): string {
  if (value >= 0.45) return "high";
  if (value >= 0.25) return "medium";
  if (value >= 0.12) return "low";
  return "very low";
}

function score(value: number): string {
  return value.toFixed(2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function resolveFfmpegPath(): string {
  return process.env.RIFTCOACH_FFMPEG_PATH || resolvePackageBinary("ffmpeg-static") || "ffmpeg";
}

function resolveFfprobePath(): string {
  return process.env.RIFTCOACH_FFPROBE_PATH || resolvePackageBinary("ffprobe-static") || "ffprobe";
}

function resolvePackageBinary(moduleName: "ffmpeg-static" | "ffprobe-static"): string | undefined {
  try {
    const value = requireFromHere(moduleName) as string | { path?: string };
    const rawPath = typeof value === "string" ? value : value.path;
    return rawPath ? unpackAsarPath(rawPath) : undefined;
  } catch {
    return undefined;
  }
}

function unpackAsarPath(filePath: string): string {
  const unpacked = filePath.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return existsSync(unpacked) ? unpacked : filePath;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectCommand(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }
      rejectCommand(new Error(`${command} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function isInside(childPath: string, parentPath: string): boolean {
  const childResolved = resolve(childPath);
  const parentResolved = resolve(parentPath);
  const rel = relative(parentResolved, childResolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function cleanNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeName(value: string | undefined): string {
  return value?.trim().toLowerCase().split("#")[0] ?? "";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "frame";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
