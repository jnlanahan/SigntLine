import { contextBridge, ipcRenderer } from "electron";
import type { CaptureRegion } from "./types";

export interface GlowMode {
  mode: "view" | "adjust";
  region: CaptureRegion | null;
}

export interface GlowApi {
  onSetMode(cb: (payload: GlowMode) => void): () => void;
  commit(region: CaptureRegion | null): Promise<void>;
  cancel(): Promise<void>;
}

const glowApi: GlowApi = {
  onSetMode: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, payload: GlowMode) =>
      cb(payload);
    ipcRenderer.on("glow:set-mode", handler);
    return () => ipcRenderer.removeListener("glow:set-mode", handler);
  },
  commit: (region) => ipcRenderer.invoke("overlay:commit-region", { region }),
  cancel: () => ipcRenderer.invoke("overlay:cancel-adjust"),
};

contextBridge.exposeInMainWorld("glowApi", glowApi);
