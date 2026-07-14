import { describe, expect, it } from "vitest";
import { parseLeagueClientLockfile } from "../src/index.ts";

describe("League Client lockfile", () => {
  it("parses the temporary local client credentials", () => {
    expect(parseLeagueClientLockfile("LeagueClient:13524:62144:temporary-token:https")).toEqual({
      processName: "LeagueClient",
      pid: 13524,
      port: 62144,
      password: "temporary-token",
      protocol: "https"
    });
  });

  it("rejects malformed credentials", () => {
    expect(() => parseLeagueClientLockfile("LeagueClient:not-a-pid:0::https")).toThrow(/malformed/i);
  });
});
