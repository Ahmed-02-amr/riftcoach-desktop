import https from "node:https";
import { URL } from "node:url";
import { LiveClientHttpError, LiveClientUnavailableError } from "./errors";
import type { RiotGameStats, RiotLiveClientHealth, RiotLiveClientOptions } from "./types";

const DEFAULT_BASE_URL = "https://127.0.0.1:2999";

export class LiveClientReader {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RiotLiveClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async readAllGameData(): Promise<any> {
    return this.requestJson("/liveclientdata/allgamedata");
  }

  async readGameStats(): Promise<RiotGameStats> {
    return this.requestJson<RiotGameStats>("/liveclientdata/gamestats");
  }

  async readActivePlayer(): Promise<any> {
    return this.requestJson("/liveclientdata/activeplayer");
  }

  async health(): Promise<RiotLiveClientHealth> {
    try {
      const stats = await this.readGameStats();
      return { reachable: true, gameTime: stats.gameTime };
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private requestJson<T = any>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "GET",
          timeout: this.timeoutMs,
          rejectUnauthorized: false,
          headers: {
            Accept: "application/json",
            "User-Agent": "RiftCoachDesktop/0.1"
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new LiveClientHttpError(statusCode, body.slice(0, 200)));
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch (error) {
              reject(new LiveClientUnavailableError(`Could not parse Live Client API JSON: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new LiveClientUnavailableError("Live Client API request timed out"));
      });
      req.on("error", (error) => {
        reject(new LiveClientUnavailableError(error.message));
      });
      req.end();
    });
  }
}
