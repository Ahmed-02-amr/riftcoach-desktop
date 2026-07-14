import { describe, expect, it } from "vitest";
import { formatChampionName } from "../src/utils/champion";

describe("champion display names", () => {
  it("humanizes Riot's internal champion identifiers", () => {
    expect(formatChampionName("MasterYi")).toBe("Master Yi");
    expect(formatChampionName("TwistedFate")).toBe("Twisted Fate");
    expect(formatChampionName("MonkeyKing")).toBe("Wukong");
    expect(formatChampionName("Kaisa")).toBe("Kai'Sa");
  });
});
