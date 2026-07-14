import https from "node:https";
import { URL } from "node:url";
import { LiveClientHttpError, LiveClientUnavailableError } from "./errors";

export interface LeagueClientConnection {
  processName: string;
  pid: number;
  port: number;
  password: string;
  protocol: "https";
}

export interface LeagueClientRankedQueue {
  queueType?: string;
  tier?: string;
  division?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
  isProvisional?: boolean;
  [key: string]: unknown;
}

export interface LeagueClientRankedStats {
  queues?: LeagueClientRankedQueue[];
  [key: string]: unknown;
}

export interface LeagueClientGameflowSession {
  gameData?: {
    queue?: { id?: number; type?: string };
    [key: string]: unknown;
  };
  phase?: string;
  [key: string]: unknown;
}

export function parseLeagueClientLockfile(value: string): LeagueClientConnection {
  const [processName, pidText, portText, password, protocolText] = value.trim().split(":");
  const pid = Number(pidText);
  const port = Number(portText);
  const protocol = protocolText?.toLowerCase();
  if (!processName || !Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || !password) {
    throw new LiveClientUnavailableError("League Client lockfile is malformed.");
  }
  if (protocol !== "https") {
    throw new LiveClientUnavailableError(`League Client lockfile uses an unsupported protocol: ${protocolText ?? "missing"}.`);
  }
  return { processName, pid, port, password, protocol };
}

export class LeagueClientApi {
  private readonly baseUrl: string;

  constructor(
    private readonly connection: LeagueClientConnection,
    private readonly timeoutMs = 2500
  ) {
    this.baseUrl = `${connection.protocol}://127.0.0.1:${connection.port}`;
  }

  readCurrentRankedStats(): Promise<LeagueClientRankedStats> {
    return this.requestJson<LeagueClientRankedStats>("/lol-ranked/v1/current-ranked-stats");
  }

  readGameflowSession(): Promise<LeagueClientGameflowSession> {
    return this.requestJson<LeagueClientGameflowSession>("/lol-gameflow/v1/session");
  }

  private requestJson<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const authorization = Buffer.from(`riot:${this.connection.password}`).toString("base64");

    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "GET",
          timeout: this.timeoutMs,
          rejectUnauthorized: false,
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${authorization}`,
            "User-Agent": "RiftCoachDesktop/0.4.5"
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
              reject(new LiveClientUnavailableError(`Could not parse League Client JSON: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        }
      );

      req.on("timeout", () => req.destroy(new LiveClientUnavailableError("League Client API request timed out")));
      req.on("error", (error) => reject(new LiveClientUnavailableError(error.message)));
      req.end();
    });
  }
}
