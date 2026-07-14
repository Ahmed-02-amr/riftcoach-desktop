import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const requireFromHere = createRequire(__filename);

export type GameRecordingState = "disabled" | "idle" | "starting" | "recording" | "finalizing" | "saved" | "error";

export interface GameRecordingStatus {
  state: GameRecordingState;
  sessionId?: string;
  filePath?: string;
  startedAtGameTimeSec?: number;
  error?: string;
}

export interface GameRecordingResult {
  sessionId: string;
  filePath: string;
  startedAtGameTimeSec: number;
  sizeBytes: number;
}

interface ActiveRecording {
  sessionId: string;
  filePath: string;
  startedAtGameTimeSec: number;
  child: ChildProcessByStdio<Writable, null, Readable>;
  closed: Promise<{ code: number | null; stderr: string }>;
}

export class GameRecordingService {
  private active: ActiveRecording | undefined;
  private status: GameRecordingStatus = { state: "idle" };
  private readonly outputDirectory: string;

  constructor(userDataPath: string) {
    this.outputDirectory = join(userDataPath, "match-vods");
  }

  getStatus(): GameRecordingStatus {
    return { ...this.status };
  }

  async start(sessionId: string, gameTimeSec: number, framesPerSecond: number): Promise<GameRecordingStatus> {
    if (this.active) return this.getStatus();
    await mkdir(this.outputDirectory, { recursive: true });
    const filePath = join(this.outputDirectory, `${sessionId}-${Date.now()}.mkv`);
    const ffmpegPath = resolveFfmpegPath();
    const args = buildLeagueRecordingArgs(filePath, framesPerSecond);
    this.status = { state: "starting", sessionId, filePath, startedAtGameTimeSec: gameTimeSec };

    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${Buffer.from(chunk).toString("utf8")}`.slice(-8_000);
    });
    const closed = new Promise<{ code: number | null; stderr: string }>((resolveClosed) => {
      child.once("close", (code) => resolveClosed({ code, stderr }));
    });
    this.active = { sessionId, filePath, startedAtGameTimeSec: Math.max(0, gameTimeSec), child, closed };

    const startup = await Promise.race([
      closed.then((result) => ({ closed: true as const, result })),
      delay(900).then(() => ({ closed: false as const }))
    ]);
    if (startup.closed) {
      this.active = undefined;
      const error = recordingError(startup.result.stderr, startup.result.code);
      this.status = { state: "error", sessionId, filePath, error };
      throw new Error(error);
    }

    this.status = { state: "recording", sessionId, filePath, startedAtGameTimeSec: Math.max(0, gameTimeSec) };
    void closed.then((result) => {
      if (this.active?.child !== child || this.status.state === "finalizing") return;
      this.status = { state: "error", sessionId, filePath, error: recordingError(result.stderr, result.code) };
    });
    return this.getStatus();
  }

  async stop(sessionId: string): Promise<GameRecordingResult | undefined> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) return undefined;
    this.status = { state: "finalizing", sessionId, filePath: active.filePath, startedAtGameTimeSec: active.startedAtGameTimeSec };
    if (active.child.exitCode === null && !active.child.killed) active.child.stdin.end("q\n");
    const result = await Promise.race([
      active.closed,
      delay(15_000).then(() => {
        if (active.child.exitCode === null && !active.child.killed) active.child.kill();
        return { code: null, stderr: "Timed out while finalizing the recording." };
      })
    ]);
    this.active = undefined;

    if (!existsSync(active.filePath) || statSync(active.filePath).size < 1_024) {
      const error = recordingError(result.stderr, result.code);
      this.status = { state: "error", sessionId, filePath: active.filePath, error };
      return undefined;
    }

    const recording: GameRecordingResult = {
      sessionId,
      filePath: active.filePath,
      startedAtGameTimeSec: active.startedAtGameTimeSec,
      sizeBytes: statSync(active.filePath).size
    };
    this.status = { state: "saved", sessionId, filePath: active.filePath, startedAtGameTimeSec: active.startedAtGameTimeSec };
    return recording;
  }

  dispose(): void {
    const child = this.active?.child;
    if (child && child.exitCode === null && !child.killed) child.kill();
    this.active = undefined;
  }
}

export function buildLeagueRecordingArgs(filePath: string, framesPerSecond: number): string[] {
  const fps = Math.max(10, Math.min(60, Math.round(framesPerSecond)));
  return [
    "-hide_banner", "-loglevel", "warning", "-y",
    "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "0",
    "-i", "title=League of Legends (TM) Client",
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    filePath
  ];
}

function resolveFfmpegPath(): string {
  const resolved = requireFromHere("ffmpeg-static") as string;
  return resolved.replace("app.asar", "app.asar.unpacked");
}

function recordingError(stderr: string, code: number | null): string {
  const detail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
  if (/window .* not found|could not find window/i.test(detail)) {
    return "League game window was not available for VOD capture. Telemetry recording continued normally.";
  }
  return `League VOD capture stopped${code === null ? "" : ` with code ${code}`}. ${detail}`.trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
