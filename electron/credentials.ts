import keytar from "keytar";

const SERVICE = "SightLine";

export type CredentialKey = "anthropic" | "openai";

const ACCOUNTS: Record<CredentialKey, string> = {
  anthropic: "anthropic-api-key",
  openai: "openai-api-key",
};

export async function getKey(name: CredentialKey): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, ACCOUNTS[name]);
  } catch (err) {
    console.error(`[credentials] failed to read ${name}:`, err);
    return null;
  }
}

export async function setKey(name: CredentialKey, value: string): Promise<void> {
  if (!value || value.trim().length === 0) {
    await keytar.deletePassword(SERVICE, ACCOUNTS[name]);
    return;
  }
  await keytar.setPassword(SERVICE, ACCOUNTS[name], value.trim());
}

export async function clearKey(name: CredentialKey): Promise<void> {
  try {
    await keytar.deletePassword(SERVICE, ACCOUNTS[name]);
  } catch (err) {
    console.error(`[credentials] failed to clear ${name}:`, err);
  }
}

export async function hasKey(name: CredentialKey): Promise<boolean> {
  const v = await getKey(name);
  return v !== null && v.length > 0;
}
