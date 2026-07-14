import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ReplayClient } from "@riftcoach/riot";

export interface ReplaySetupStatus {
  installed: boolean;
  installPath?: string;
  executablePath?: string;
  configPath?: string;
  enabled: boolean;
  apiReachable: boolean;
  backupPath?: string;
  message: string;
}

export interface ReplayLaunchResult {
  executablePath?: string;
  launched: boolean;
  warning?: string;
}

export interface LeagueInstallation {
  installPath: string;
  executablePath?: string;
  configPath?: string;
  lockfilePath?: string;
}

export class LeagueReplayService {
  async getSetupStatus(): Promise<ReplaySetupStatus> {
    const installation = await discoverLeagueInstallation();
    if (!installation) {
      return {
        installed: false,
        enabled: false,
        apiReachable: false,
        message: "League installation was not found. RiftCoach can still parse ROFL metadata offline."
      };
    }

    const enabled = installation.configPath ? await isReplayApiEnabled(installation.configPath) : false;
    const apiReachable = (await new ReplayClient({ timeoutMs: 1200 }).health()).reachable;
    return {
      installed: true,
      ...installation,
      enabled,
      apiReachable,
      message: enabled
        ? apiReachable
          ? "Replay API is enabled and a League replay is currently reachable."
          : "Replay API is enabled. It becomes reachable after a League replay opens."
        : "Replay API is disabled. Offline ROFL metadata still works; enable it for replay frames and video rendering."
    };
  }

  async enableReplayApi(): Promise<ReplaySetupStatus> {
    const installation = await discoverLeagueInstallation();
    if (!installation?.configPath) throw new Error("League game.cfg could not be found.");

    const original = await readFile(installation.configPath, "utf8");
    const updated = updateReplayApiSetting(original, true);
    let backupPath: string | undefined;
    if (updated !== original) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${installation.configPath}.riftcoach-backup-${stamp}`;
      await copyFile(installation.configPath, backupPath);
      await writeFile(installation.configPath, updated, "utf8");
    }

    const enabled = await isReplayApiEnabled(installation.configPath);
    if (!enabled) throw new Error("RiftCoach wrote game.cfg, but Replay API verification did not pass.");
    const status = await this.getSetupStatus();
    return {
      ...status,
      backupPath,
      message: status.apiReachable
        ? "Replay API is enabled and reachable."
        : "Replay API enabled. Restart any open replay, then import the ROFL again."
    };
  }

  async launchReplay(replayPath: string): Promise<ReplayLaunchResult> {
    const installation = await discoverLeagueInstallation();
    if (!installation?.executablePath) {
      return { launched: false, warning: "League of Legends.exe was not found. Offline ROFL metadata import will continue." };
    }
    try {
      await launchDetached(installation.executablePath, [resolve(replayPath)], dirname(installation.executablePath));
      return { executablePath: installation.executablePath, launched: true };
    } catch (error) {
      return {
        executablePath: installation.executablePath,
        launched: false,
        warning: `League replay launch failed; offline metadata import will continue. ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

export function updateReplayApiSetting(input: string, enabled: boolean): string {
  const newline = input.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = input.endsWith("\n");
  const lines = input.split(/\r?\n/);
  const desired = `EnableReplayApi=${enabled ? 1 : 0}`;
  let generalStart = -1;
  let generalEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(lines[index] ?? "");
    if (!section?.[1]) continue;
    if (generalStart >= 0) {
      generalEnd = index;
      break;
    }
    if (section[1].trim().toLowerCase() === "general") generalStart = index;
  }

  if (generalStart < 0) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push("[General]", desired);
  } else {
    const existingIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => index > generalStart && index < generalEnd && /^\s*EnableReplayApi\s*=/i.test(line))
      .map(({ index }) => index);
    const existingIndex = existingIndexes[0];
    if (existingIndex !== undefined) {
      lines[existingIndex] = desired;
      for (const duplicateIndex of existingIndexes.slice(1).reverse()) lines.splice(duplicateIndex, 1);
    } else {
      lines.splice(generalStart + 1, 0, desired);
    }
  }

  let output = lines.join(newline);
  if (hadTrailingNewline && !output.endsWith(newline)) output += newline;
  return output;
}

async function isReplayApiEnabled(configPath: string): Promise<boolean> {
  try {
    const contents = await readFile(configPath, "utf8");
    const general = sectionValue(contents, "General");
    return /^\s*(1|true)\s*$/i.test(general.EnableReplayApi ?? "");
  } catch {
    return false;
  }
}

function sectionValue(input: string, sectionName: string): Record<string, string> {
  const result: Record<string, string> = {};
  let active = false;
  for (const line of input.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section?.[1]) {
      active = section[1].trim().toLowerCase() === sectionName.toLowerCase();
      continue;
    }
    if (!active) continue;
    const entry = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (entry?.[1] && entry[2] !== undefined) result[entry[1].trim()] = entry[2].trim();
  }
  return result;
}

export async function discoverLeagueInstallation(): Promise<LeagueInstallation | undefined> {
  const installPaths = new Set<string>();
  const explicitExecutable = process.env.RIFTCOACH_LEAGUE_EXE?.trim();
  if (explicitExecutable) installPaths.add(resolve(explicitExecutable, "..", ".."));

  const programData = process.env.ProgramData || "C:\\ProgramData";
  const installsJson = join(programData, "Riot Games", "RiotClientInstalls.json");
  try {
    const parsed = JSON.parse(await readFile(installsJson, "utf8")) as any;
    for (const path of Object.keys(parsed?.associated_client ?? {})) {
      if (/league of legends/i.test(path)) installPaths.add(normalizeWindowsPath(path));
    }
  } catch {
    // Fall through to product metadata and conventional paths.
  }

  const productMetadata = join(programData, "Riot Games", "Metadata", "league_of_legends.live", "league_of_legends.live.product_settings.yaml");
  try {
    const yaml = await readFile(productMetadata, "utf8");
    const match = /^product_install_full_path:\s*["']?(.+?)["']?\s*$/im.exec(yaml);
    if (match?.[1]) installPaths.add(normalizeWindowsPath(match[1]));
  } catch {
    // Conventional paths remain useful on clean installations.
  }

  for (const candidate of [
    "C:\\Riot Games\\League of Legends",
    process.env.SystemDrive ? `${process.env.SystemDrive}\\Riot Games\\League of Legends` : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Riot Games", "League of Legends") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Riot Games", "League of Legends") : undefined
  ]) {
    if (candidate) installPaths.add(resolve(candidate));
  }

  for (const installPath of installPaths) {
    const executablePath = explicitExecutable && existsSync(explicitExecutable)
      ? explicitExecutable
      : [join(installPath, "Game", "League of Legends.exe"), join(installPath, "League of Legends.exe")].find(existsSync);
    const configPath = [
      join(installPath, "Config", "game.cfg"),
      join(installPath, "DATA", "CFG", "game.cfg"),
      join(installPath, "Game", "Config", "game.cfg")
    ].find(existsSync);
    const lockfilePath = [join(installPath, "lockfile"), join(installPath, "LeagueClient", "lockfile")].find(existsSync);
    if (executablePath || configPath || lockfilePath) return { installPath, executablePath, configPath, lockfilePath };
  }
  return undefined;
}

function normalizeWindowsPath(value: string): string {
  return resolve(value.replaceAll("/", "\\").replace(/[\\/]+$/, ""));
}

function launchDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let settled = false;
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveLaunch();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectLaunch(error);
    });
  });
}
