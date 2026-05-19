import { useEffect, useState } from "react";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import type { DisplayInfo } from "../lib/api";
import { IntervalSlider } from "./IntervalSlider";

interface Props {
  onClose(): void;
}

export function Settings({ onClose }: Props) {
  const settings = useSettings((s) => s.settings);
  const keyStatus = useSettings((s) => s.keyStatus);
  const patch = useSettings((s) => s.patch);
  const refreshKeyStatus = useSettings((s) => s.refreshKeyStatus);

  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    void api().displays.list().then(setDisplays);
  }, []);

  async function saveKey(name: "anthropic" | "openai", value: string) {
    if (!value.trim()) return;
    await api().keys.set(name, value);
    await refreshKeyStatus();
    if (name === "anthropic") setAnthropicKey("");
    else setOpenaiKey("");
    setSavedMsg(`${name} key saved`);
    window.setTimeout(() => setSavedMsg(null), 1800);
  }

  async function clearKey(name: "anthropic" | "openai") {
    await api().keys.clear(name);
    await refreshKeyStatus();
  }

  if (!settings) return null;

  return (
    <div className="sl-scroll flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-panel-border px-2 py-1 text-xs text-neutral-300 hover:bg-black/40"
        >
          Close
        </button>
      </div>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide text-neutral-400">
          Anthropic API key
        </label>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder={keyStatus.anthropic ? "●●●●●● saved" : "sk-ant-..."}
            className="flex-1 rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveKey("anthropic", anthropicKey)}
            className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white"
          >
            Save
          </button>
          {keyStatus.anthropic && (
            <button
              type="button"
              onClick={() => void clearKey("anthropic")}
              className="rounded-md border border-panel-border px-2 py-1 text-xs text-neutral-300 hover:bg-error/30"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide text-neutral-400">
          OpenAI API key (voice input)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder={keyStatus.openai ? "●●●●●● saved" : "sk-..."}
            className="flex-1 rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveKey("openai", openaiKey)}
            className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white"
          >
            Save
          </button>
          {keyStatus.openai && (
            <button
              type="button"
              onClick={() => void clearKey("openai")}
              className="rounded-md border border-panel-border px-2 py-1 text-xs text-neutral-300 hover:bg-error/30"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide text-neutral-400">
          Display
        </label>
        <select
          title="Select display"
          value={settings.selectedDisplayId ?? ""}
          onChange={(e) => patch({ selectedDisplayId: e.target.value || null })}
          className="rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-100"
        >
          <option value="">Primary display (auto)</option>
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} {d.primary ? "(primary)" : ""} — {d.width}×{d.height}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex items-center justify-between text-[11px] uppercase tracking-wide text-neutral-400">
          Overlay opacity
          <span className="text-neutral-200">{Math.round(settings.opacity * 100)}%</span>
        </label>
        <input
          type="range"
          title="Overlay opacity"
          min={0.4}
          max={1}
          step={0.02}
          value={settings.opacity}
          onChange={(e) => {
            const v = Number(e.target.value);
            void patch({ opacity: v });
            void api().window.setOpacity(v);
          }}
          className="slider-range"
        />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wide text-neutral-400">
          Check frequency
        </label>
        <IntervalSlider
          value={settings.captureIntervalSec}
          onChange={(v) => patch({ captureIntervalSec: v })}
        />
      </section>

      <section className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">
            Read instructions aloud
          </p>
          <p className="text-[10px] text-neutral-500">Uses your device's built-in voice</p>
        </div>
        <button
          type="button"
          onClick={() => patch({ ttsEnabled: !settings.ttsEnabled })}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            settings.ttsEnabled ? "bg-accent" : "bg-neutral-600"
          }`}
          role="switch"
          aria-checked={settings.ttsEnabled ? "true" : "false"}
          title="Toggle read aloud"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              settings.ttsEnabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </section>

      {savedMsg && (
        <p className="text-[11px] text-watching">{savedMsg}</p>
      )}
    </div>
  );
}
