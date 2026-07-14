import https from "node:https";
import { URL } from "node:url";

export type RiotRegionalRoute = "americas" | "europe" | "asia" | "sea";

export interface RiotAccountDto {
  puuid: string;
  gameName?: string;
  tagLine?: string;
}

export interface RiotMatchV5ClientOptions {
  apiKey: string;
  regionalRoute: RiotRegionalRoute;
  timeoutMs?: number;
}

export class RiotMatchV5Client {
  private readonly timeoutMs: number;

  constructor(private readonly options: RiotMatchV5ClientOptions) {
    if (!options.apiKey.trim()) throw new Error("Riot API key is required.");
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccountDto> {
    return this.get<RiotAccountDto>(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  listMatchIds(puuid: string, count = 5): Promise<string[]> {
    return this.get<string[]>(`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${Math.max(1, Math.min(20, Math.round(count)))}`);
  }

  getMatch(matchId: string): Promise<any> {
    return this.get(`/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  getTimeline(matchId: string): Promise<any> {
    return this.get(`/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`);
  }

  private get<T = any>(path: string): Promise<T> {
    const url = new URL(path, `https://${this.options.regionalRoute}.api.riotgames.com`);
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "GET",
          timeout: this.timeoutMs,
          headers: { Accept: "application/json", "X-Riot-Token": this.options.apiKey, "User-Agent": "RiftCoachDesktop/0.4.1" }
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              const detail = status === 401 || status === 403 ? "Check whether the Riot API key is valid and approved for this use." : text.slice(0, 240);
              reject(new Error(`Riot API returned HTTP ${status}. ${detail}`.trim()));
              return;
            }
            try {
              resolve((text.trim() ? JSON.parse(text) : undefined) as T);
            } catch (error) {
              reject(new Error(`Riot API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("Riot API request timed out.")));
      req.on("error", reject);
      req.end();
    });
  }
}

export function riotRegionalRouteForPlatform(platformId: string): RiotRegionalRoute {
  const platform = platformId.trim().toUpperCase();
  if (["BR1", "LA1", "LA2", "NA1"].includes(platform)) return "americas";
  if (["EUN1", "EUW1", "ME1", "RU", "TR1"].includes(platform)) return "europe";
  if (["JP1", "KR"].includes(platform)) return "asia";
  return "sea";
}
