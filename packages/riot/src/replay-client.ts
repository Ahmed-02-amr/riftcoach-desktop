import https from "node:https";
import { URL } from "node:url";
import { LiveClientHttpError, LiveClientUnavailableError } from "./errors";
import type { RiotReplayGame, RiotReplayHealth, RiotReplayPlayback, RiotReplayRecording, RiotReplayRender, RiotLiveClientOptions } from "./types";

const DEFAULT_BASE_URL = "https://127.0.0.1:2999";

export class ReplayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RiotLiveClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 2500;
  }

  async readPlayback(): Promise<RiotReplayPlayback> {
    return this.requestJson<RiotReplayPlayback>("/replay/playback");
  }

  async updatePlayback(input: Partial<RiotReplayPlayback>): Promise<RiotReplayPlayback> {
    return this.requestJson<RiotReplayPlayback>("/replay/playback", "POST", input);
  }

  async readGame(): Promise<RiotReplayGame> {
    return this.requestJson<RiotReplayGame>("/replay/game");
  }

  async readRender(): Promise<RiotReplayRender> {
    return this.requestJson<RiotReplayRender>("/replay/render");
  }

  async updateRender(input: Partial<RiotReplayRender>): Promise<RiotReplayRender> {
    return this.requestJson<RiotReplayRender>("/replay/render", "POST", input);
  }

  async readRecording(): Promise<RiotReplayRecording> {
    return this.requestJson<RiotReplayRecording>("/replay/recording");
  }

  async updateRecording(input: Partial<RiotReplayRecording>): Promise<RiotReplayRecording> {
    return this.requestJson<RiotReplayRecording>("/replay/recording", "POST", input);
  }

  async seek(timestampSec: number, pause = true): Promise<RiotReplayPlayback> {
    return this.updatePlayback({ time: Math.max(0, timestampSec), paused: pause });
  }

  async health(): Promise<RiotReplayHealth> {
    try {
      const playback = await this.readPlayback();
      return { reachable: true, playback };
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private requestJson<T = any>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          timeout: this.timeoutMs,
          rejectUnauthorized: false,
          headers: {
            Accept: "application/json",
            "User-Agent": "RiftCoachDesktop/0.4.3",
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new LiveClientHttpError(statusCode, text.slice(0, 200)));
              return;
            }
            if (!text.trim()) {
              resolve({} as T);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (error) {
              reject(new LiveClientUnavailableError(`Could not parse Replay API JSON: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new LiveClientUnavailableError("Replay API request timed out"));
      });
      req.on("error", (error) => {
        reject(new LiveClientUnavailableError(error.message));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
