import { app, safeStorage } from "electron";
import log from "electron-log";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface StoredSecret {
  encoding: "safeStorage";
  value: string;
  updatedAtIso: string;
}

type SecretFile = Record<string, StoredSecret>;

export class CredentialStore {
  private readonly filePath = join(app.getPath("userData"), "credentials.enc.json");

  async getSecret(account: string): Promise<string | undefined> {
    try {
      const file = await this.readFile();
      const entry = file[account];
      if (!entry) return undefined;
      if (entry.encoding !== "safeStorage") return undefined;
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn("safeStorage encryption is unavailable; credential read skipped");
        return undefined;
      }
      return safeStorage.decryptString(Buffer.from(entry.value, "base64"));
    } catch (error) {
      log.warn("credential read failed", error);
      return undefined;
    }
  }

  async setSecret(account: string, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable. Refusing to store secrets unencrypted.");
    }

    const file = await this.readFile();
    file[account] = {
      encoding: "safeStorage",
      value: safeStorage.encryptString(secret).toString("base64"),
      updatedAtIso: new Date().toISOString()
    };
    await this.writeFile(file);
  }

  async deleteSecret(account: string): Promise<void> {
    try {
      const file = await this.readFile();
      delete file[account];
      const keys = Object.keys(file);
      if (keys.length === 0) {
        await unlink(this.filePath).catch(() => undefined);
      } else {
        await this.writeFile(file);
      }
    } catch (error) {
      log.warn("credential delete failed", error);
    }
  }

  private async readFile(): Promise<SecretFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as SecretFile;
    } catch {
      return {};
    }
  }

  private async writeFile(file: SecretFile): Promise<void> {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}
