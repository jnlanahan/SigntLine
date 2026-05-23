import { useEffect, useState } from "react";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import type { DisplayInfo, TtsVoiceId } from "../lib/api";
import { useTts, getTtsMode } from "../hooks/useTts";

const FREQ_TIERS = [
  { label: "Low",  value: 30, hint: "saves tokens" },
  { label: "Med",  value: 15 },
  { label: "High", value: 5,  hint: "more API calls" },
] as const;

function secToTier(sec: number): number {
  if (sec <= 7) return 5;
  if (sec <= 20) return 15;
  return 30;
}

const VOICE_OPTIONS: { id: TtsVoiceId; label: string; sample: string }[] = [
  { id: "nova",    label: "Nova — warm, friendly (default)", sample: "Hey, I'm Nova. Ready when you are." },
  { id: "shimmer", label: "Shimmer — bright, upbeat",        sample: "Hi there — let's get this going!" },
  { id: "sage",    label: "Sage — calm, thoughtful",         sample: "Okay, take your time. I'm right here with you." },
  { id: "coral",   label: "Coral — warm, expressive",        sample: "Alright, let's walk through this together." },
  { id: "alloy",   label: "Alloy — neutral, clear",          sample: "Hello. I'll guide you through the next step." },
  { id: "echo",    label: "Echo — soft, balanced",           sample: "Hey, let me know when you're ready to go." },
  { id: "fable",   label: "Fable — gentle, narrative",       sample: "Once you're set, we'll begin." },
  { id: "onyx",    label: "Onyx — deeper, steady",           sample: "Alright. Let's take it one step at a time." },
];

interface Props {
  onClose(): void;
}

export function Settings({ onClose }: Props) {
  const settings  = useSettings((s) => s.settings);
  const keyStatus = useSettings((s) => s.keyStatus);
  const patch     = useSettings((s) => s.patch);

  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => { void api().displays.list().then(setDisplays); }, []);

  if (!settings) return null;

  return (
    <div className="sl-sheet-in absolute inset-0 flex flex-col" style={{ background: "#0d1117" }}>
      {/* Header */}
      <div
        className="flex flex-shrink-0 items-center gap-2.5 px-3.5 py-3"
        style={{
          borderBottom: "1px solid rgba(244,232,218,0.08)",
          background: "rgba(10,15,26,0.7)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-sl-iconHover"
          style={{ border: 0, background: "transparent", cursor: "pointer" }}
          title="Back"
        >
          <BackArrowIcon />
        </button>
        <h2 className="text-sm font-semibold tracking-tight text-sl-ink">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-sl-iconHover"
          style={{ border: 0, background: "transparent", cursor: "pointer" }}
          title="Close"
        >
          <CloseXIcon />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="sl-scroll flex flex-1 flex-col gap-[18px] overflow-y-auto px-3.5 py-4">

        {/* Capture */}
        <SettingsSection label="Capture">
          <SettingRow label="Check frequency">
            <div className="no-drag flex gap-1.5">
              {FREQ_TIERS.map((tier) => {
                const active = secToTier(settings.captureIntervalSec) === tier.value;
                return (
                  <button
                    key={tier.label}
                    type="button"
                    onClick={() => void patch({ captureIntervalSec: tier.value })}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 9,
                      border: active
                        ? "1px solid #8FC4EC"
                        : "1px solid rgba(244,232,218,0.08)",
                      background: active ? "rgba(143,196,236,0.12)" : "rgba(244,232,218,0.04)",
                      color: active ? "#8FC4EC" : "#B8A89A",
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all 140ms",
                    }}
                  >
                    {tier.label}
                    {"hint" in tier && (
                      <span style={{ display: "block", fontSize: 9, opacity: 0.6, marginTop: 1 }}>
                        {tier.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          <SettingRow label="Display">
            <select
              title="Select display"
              value={settings.selectedDisplayId ?? ""}
              onChange={(e) => patch({ selectedDisplayId: e.target.value || null })}
              style={selectStyle}
            >
              <option value="">Primary display (auto)</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} {d.primary ? "(primary)" : ""} — {d.width}×{d.height}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Capture area" hint={
            settings.captureRegion
              ? `${settings.captureRegion.width}×${settings.captureRegion.height} region`
              : "full display"
          }>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void api().overlay.setAdjust(true); onClose(); }}
                style={saveBtnStyle}
              >
                Adjust
              </button>
              {settings.captureRegion && (
                <button
                  type="button"
                  onClick={() => void patch({ captureRegion: null })}
                  style={clearBtnStyle}
                >
                  Reset
                </button>
              )}
            </div>
          </SettingRow>
        </SettingsSection>

        {/* Window */}
        <SettingsSection label="Window">
          <ToggleRow
            label="Read instructions aloud"
            hint={keyStatus.openai ? "Using OpenAI voice" : "Using system voice"}
            checked={settings.ttsEnabled}
            onChange={(v) => patch({ ttsEnabled: v })}
          />
        </SettingsSection>

        {/* Voice */}
        <SettingsSection label="Voice">
          <VoicePicker disabled={!settings.ttsEnabled || !keyStatus.openai} />
        </SettingsSection>

        {/* Footer */}
        <div
          className="mt-1 text-center"
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 10,
            color: "#7A6E63",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          SightLine
        </div>
      </div>
    </div>
  );
}

/* ── Settings sub-components ── */

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 10,
          color: "#7A6E63",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-sl-ink">{label}</span>
        {hint && (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#7A6E63" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col">
        <span className="text-[12.5px] font-medium text-sl-ink">{label}</span>
        {hint && <span className="mt-0.5 text-[10px] text-sl-ink3">{hint}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className="relative flex-shrink-0 rounded-full border-0 transition-colors"
        style={{
          width: 34, height: 20,
          background: checked ? "#8FC4EC" : "rgba(244,232,218,0.06)",
          cursor: "pointer",
          padding: 0,
          transition: "background 180ms",
        }}
      >
        <span
          className="absolute top-[2px] rounded-full bg-white shadow"
          style={{
            left: checked ? 14 : 2,
            width: 16, height: 16,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transition: "left 180ms cubic-bezier(0.3,0,0.2,1)",
          }}
        />
      </button>
    </div>
  );
}

/* ── Shared style objects ── */
const saveBtnStyle: React.CSSProperties = {
  borderRadius: 9,
  background: "#8FC4EC",
  color: "#0d1117",
  fontSize: 11.5,
  fontWeight: 600,
  padding: "6px 12px",
  border: 0,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  borderRadius: 9,
  border: "1px solid rgba(244,232,218,0.08)",
  background: "transparent",
  color: "#B8A89A",
  fontSize: 11.5,
  fontWeight: 500,
  padding: "6px 12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  background: "rgba(244,232,218,0.04)",
  color: "#F4E8DA",
  border: "1px solid rgba(244,232,218,0.08)",
  borderRadius: 10,
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  cursor: "pointer",
  appearance: "none",
};

/* ── VoicePicker ── */
function VoicePicker({ disabled }: { disabled: boolean }) {
  const settings = useSettings((s) => s.settings);
  const patch    = useSettings((s) => s.patch);
  const { speak } = useTts();
  const [previewResult, setPreviewResult] = useState<
    "openai" | "system" | "none" | "pending" | null
  >(null);

  if (!settings) return null;

  function handlePreview() {
    const opt = VOICE_OPTIONS.find((v) => v.id === settings!.ttsVoice) ?? VOICE_OPTIONS[0];
    setPreviewResult("pending");
    speak(opt.sample);
    window.setTimeout(() => {
      setPreviewResult(getTtsMode() ?? "none");
    }, 2500);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          title="Voice"
          disabled={disabled}
          value={settings.ttsVoice}
          onChange={(e) => void patch({ ttsVoice: e.target.value as TtsVoiceId })}
          style={{ ...selectStyle, flex: 1, opacity: disabled ? 0.4 : 1 }}
        >
          {VOICE_OPTIONS.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handlePreview}
          style={{
            ...clearBtnStyle,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
          title="Preview voice"
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
            <path d="M1 1l6 4-6 4z" fill="#B8A89A" />
          </svg>
          Preview
        </button>
      </div>
      {previewResult === "pending" && (
        <p style={{ fontSize: 10, color: "#7A6E63" }}>Testing…</p>
      )}
      {previewResult === "openai" && (
        <p style={{ fontSize: 10, color: "#5BD08B" }}>✓ Natural voice (OpenAI) — working</p>
      )}
      {previewResult === "system" && (
        <p style={{ fontSize: 10, color: "#f59e0b" }}>⚠ System voice only — add your OpenAI key for natural voice</p>
      )}
      {previewResult === "none" && (
        <p style={{ fontSize: 10, color: "#ef4444" }}>✗ No audio — check audio permissions or your API key</p>
      )}
    </div>
  );
}

/* ── Icons ── */
function BackArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9 2L4 7l5 5" stroke="#B8A89A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseXIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="#B8A89A" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
