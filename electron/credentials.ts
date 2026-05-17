import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export type CredentialKey = "anthropic" | "openai";

function keysPath(): string {
  return path.join(app.getPath("userData"), "keys.json");
}

function readStore(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(keysPath(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(keysPath()), { recursive: true });
    fs.writeFileSync(keysPath(), JSON.stringify(store), "utf-8");
  } catch (err) {
    console.error("[credentials] failed to write store:", err);
  }
}

export async function getKey(name: CredentialKey): Promise<string | null> {
  try {
    const store = readStore();
    const encrypted = store[name];
    if (!encrypted) return null;
    const buf = Buffer.from(encrypted, "base64");
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    // Fallback: stored as plain base64 when encryption unavailable
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

export async function setKey(name: CredentialKey, value: string): Promise<void> {
  const store = readStore();
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    delete store[name];
  } else if (safeStorage.isEncryptionAvailable()) {
    store[name] = safeStorage.encryptString(trimmed).toString("base64");
  } else {
    store[name] = Buffer.from(trimmed).toString("base64");
  }
  writeStore(store);
}

export async function clearKey(name: CredentialKey): Promise<void> {
  const store = readStore();
  delete store[name];
  writeStore(store);
}

export async function hasKey(name: CredentialKey): Promise<boolean> {
  const v = await getKey(name);
  return v !== null && v.length > 0;
}
