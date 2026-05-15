import { create } from "zustand";
import type { ApiKeyStatus, Settings } from "../lib/api";
import { api } from "../lib/api";

interface SettingsStore {
  settings: Settings | null;
  keyStatus: ApiKeyStatus;
  load(): Promise<void>;
  patch(p: Partial<Settings>): Promise<void>;
  refreshKeyStatus(): Promise<void>;
}

export const useSettings = create<SettingsStore>((set) => ({
  settings: null,
  keyStatus: { anthropic: false, openai: false },
  async load() {
    const [settings, keyStatus] = await Promise.all([
      api().settings.get(),
      api().keys.status(),
    ]);
    set({ settings, keyStatus });
  },
  async patch(p) {
    const next = await api().settings.set(p);
    set({ settings: next });
  },
  async refreshKeyStatus() {
    const keyStatus = await api().keys.status();
    set({ keyStatus });
  },
}));
