import { describe, expect, it } from "vitest";
import { RankSnapshotRepository } from "../src/repositories.ts";

describe("rank snapshots", () => {
  it("maps separate before and after values for a recorded match", () => {
    const rows = new Map<string, Record<string, unknown>>();
    const database = {
      prepare(sql: string) {
        if (/INSERT INTO rank_snapshots/.test(sql)) {
          return {
            run(...values: unknown[]) {
              const [scope_key, session_id, phase, queue_type, rank, tier, division, lp, wins, losses, provisional, source, synced_at, match_queue_id] = values;
              rows.set(String(scope_key), { scope_key, session_id, phase, queue_type, rank, tier, division, lp, wins, losses, provisional, source, synced_at, match_queue_id });
            }
          };
        }
        if (/SELECT \* FROM rank_snapshots/.test(sql)) {
          return { get(scopeKey: string) { return rows.get(scopeKey); } };
        }
        throw new Error(`Unexpected test query: ${sql}`);
      }
    } as any;
    const snapshots = new RankSnapshotRepository(database);

    snapshots.saveForSession("session-1", "before", {
      queueType: "RANKED_SOLO_5x5", rank: "Gold I", tier: "GOLD", division: "I", lp: 62,
      wins: 37, losses: 31, source: "league-client", syncedAtIso: "2026-07-14T18:00:00.000Z", matchQueueId: 420
    });
    snapshots.saveForSession("session-1", "after", {
      queueType: "RANKED_SOLO_5x5", rank: "Gold I", tier: "GOLD", division: "I", lp: 84,
      wins: 38, losses: 31, source: "league-client", syncedAtIso: "2026-07-14T18:35:00.000Z", matchQueueId: 420
    });

    expect(snapshots.getForSession("session-1", "before")?.lp).toBe(62);
    expect(snapshots.getForSession("session-1", "after")).toMatchObject({ lp: 84, wins: 38, matchQueueId: 420 });
  });
});
