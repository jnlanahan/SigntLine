// sightline/panels.tsx
// The five SightLine overlay views as standalone components. Each accepts an
// optional `accent` (defaults to the ambient theme, or lime) and renders a
// floating glass panel + ambient glow — drop it onto any dark surface.
import React from "react";
import { AccentName } from "./theme";
import { SightLineTheme, useTheme } from "./ThemeProvider";
import { ar, lt } from "./theme";
import { Glow, Logo, StarMark, Spinner, Waveform, Eyebrow, Cmd, CtrlBtn, ChatInput, SpeakingStrip, StepRow, MiniStep, Panel } from "./primitives";
import { IList, IPause, IGear, IExpand, IMic, ISpark, ISupport, IClipboard, ICap, IChevron } from "./icons";

function Themed({ accent, children }: { accent?: AccentName; children: React.ReactNode }) {
  return accent ? <SightLineTheme accent={accent}>{children}</SightLineTheme> : <>{children}</>;
}

// ─── Mode picker (Home) ─────────────────────────────────────────
export type SightLineMode = "tech_support" | "training" | "teacher";

export interface ModeDef {
  id: SightLineMode;
  title: string;
  blurb: string;
  Icon: (p: { c?: string }) => JSX.Element;
}

export const MODES: ModeDef[] = [
  { id: "tech_support", title: "Tech Support", blurb: "Walks you through a task step by step while watching your screen.", Icon: ISupport },
  { id: "training", title: "Training", blurb: "Build a structured training plan together as you demonstrate it on screen.", Icon: IClipboard },
  { id: "teacher", title: "Teacher", blurb: "Learn a subject from sources you choose — a PDF, a paper, a site.", Icon: ICap },
];

function ModeCardRow({ m, active, onSelect }: { m: ModeDef; active: boolean; onSelect?: () => void }) {
  const T = useTheme();
  const { Icon } = m;
  return (
    <div className="sl-card" onClick={onSelect} style={{
      display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 13px", borderRadius: 13, cursor: "pointer",
      background: active ? ar(T.accentRGB, 0.1) : lt(0.035),
      border: `1px solid ${active ? ar(T.accentRGB, 0.34) : lt(0.08)}`,
    }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: active ? ar(T.accentRGB, 0.16) : lt(0.05), color: active ? T.accent : T.ink2, border: `1px solid ${active ? ar(T.accentRGB, 0.3) : lt(0.08)}` }}><Icon /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14.5, fontWeight: 650, color: T.ink, letterSpacing: "-0.01em" }}>{m.title}</span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: T.ink2 }}>{m.blurb}</span>
      </span>
      <span style={{ color: active ? T.accent : T.ink3, alignSelf: "center", flexShrink: 0 }}><IChevron /></span>
    </div>
  );
}

export interface ModePickerProps {
  accent?: AccentName;
  width?: number;
  selected?: SightLineMode;
  modes?: ModeDef[];
  onSelect?: (mode: SightLineMode) => void;
  onSettings?: () => void;
}

export function ModePicker({ accent, width = 412, selected = "tech_support", modes = MODES, onSelect, onSettings }: ModePickerProps) {
  return (
    <Themed accent={accent}>
      <Inner width={width} selected={selected} modes={modes} onSelect={onSelect} onSettings={onSettings} />
    </Themed>
  );
  function Inner({ width, selected, modes, onSelect, onSettings }: Required<Pick<ModePickerProps, "width">> & ModePickerProps) {
    const T = useTheme();
    return (
      <div style={{ position: "relative", width }}>
        <Glow />
        <Panel width={width!} gap={18}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <Logo />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 23, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.05 }}>SightLine</div>
              <div style={{ marginTop: 3, fontSize: 12.5, color: T.ink3, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.ink3 }} />Ready when you are
              </div>
            </div>
            <CtrlBtn title="Settings" onClick={onSettings}><IGear /></CtrlBtn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <Eyebrow>Choose a mode</Eyebrow>
              <div style={{ marginTop: 5, fontSize: 13, color: T.ink2 }}>SightLine can see your screen in every mode.</div>
            </div>
            {modes!.map((m) => <ModeCardRow key={m.id} m={m} active={selected === m.id} onSelect={() => onSelect?.(m.id)} />)}
          </div>
        </Panel>
      </div>
    );
  }
}

// ─── Expanded ───────────────────────────────────────────────────
export interface ExpandedPanelProps {
  accent?: AccentName;
  width?: number;
  mode?: string;
  goal?: string;
  instruction?: React.ReactNode;
  completed?: string[];
  context?: string[];
  speaking?: boolean;
  onSend?: () => void;
  onPause?: () => void;
  onSettings?: () => void;
  onSteps?: () => void;
}

export function ExpandedPanel(props: ExpandedPanelProps) {
  const {
    accent, width = 412, mode = "Tech Support", goal = "Solve the ABI mismatch with keytar.",
    instruction, completed = ["Goal Set", "Capture Initial State", "Error Identified: keytar mismatch"],
    context = ["'.env' keys", "package.json"], speaking = true, onSend, onPause, onSettings, onSteps,
  } = props;
  return (
    <Themed accent={accent}>
      <Body />
    </Themed>
  );
  function Body() {
    const T = useTheme();
    return (
      <div style={{ position: "relative", width }}>
        <Glow />
        <Panel width={width}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <Logo />
            <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
              <div style={{ fontSize: 23, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.05 }}>SightLine</div>
              <div style={{ marginTop: 3, fontSize: 12.5, color: T.ink2 }}>AI: WATCHING <span style={{ color: T.ink3 }}>(Alert: 2s interval)</span></div>
            </div>
            <Spinner />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: -4 }}>
            <span style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 600, color: T.accent, padding: "3px 10px", borderRadius: 999, background: ar(T.accentRGB, 0.12), border: `1px solid ${ar(T.accentRGB, 0.28)}` }}>{mode}</span>
            <div style={{ fontSize: 14.5, lineHeight: 1.4, color: T.ink }}><span style={{ color: T.ink3 }}>Goal&nbsp;·&nbsp;</span>{goal}</div>
          </div>
          <div style={{ borderRadius: 14, background: T.instr, border: `1px solid ${lt(0.07)}`, boxShadow: "0 10px 30px -12px rgba(0,0,0,0.8)", padding: "15px 16px" }}>
            <Eyebrow>Current step</Eyebrow>
            <div style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.5, color: "#E6EAF0" }}>
              {instruction ?? <>In your terminal, run <Cmd>npm&nbsp;run&nbsp;rebuild</Cmd>. This rebuilds native modules against Electron's Node ABI. I'm listening for confirmation.</>}
            </div>
          </div>
          {speaking && <SpeakingStrip />}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Eyebrow>Completed</Eyebrow>
              <span style={{ fontSize: 11, color: T.ink3, fontVariantNumeric: "tabular-nums" }}>{completed.length} done</span>
            </div>
            {completed.map((s, i) => <StepRow key={s} label={s} dim={i > 0} />)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <Eyebrow>Context</Eyebrow>
            {context.map((n) => <span key={n} style={{ fontSize: 11.5, color: T.ink2, padding: "3px 9px", borderRadius: 8, background: lt(0.05), border: `1px solid ${T.border}`, fontFamily: '"SF Mono", ui-monospace, monospace' }}>{n}</span>)}
          </div>
          <ChatInput onSend={onSend} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 12, borderTop: `1px solid ${lt(0.07)}`, marginTop: 2 }}>
            <CtrlBtn title="Steps" onClick={onSteps}><IList /></CtrlBtn>
            <CtrlBtn title="Pause" onClick={onPause}><IPause /></CtrlBtn>
            <CtrlBtn title="Settings" onClick={onSettings}><IGear /></CtrlBtn>
            <div style={{ flex: 1 }} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em", color: T.accent, padding: "6px 12px", borderRadius: 999, background: ar(T.accentRGB, 0.1), border: `1px solid ${ar(T.accentRGB, 0.22)}` }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent, boxShadow: `0 0 8px ${T.accent}`, animation: "sl-blink 1.6s ease-in-out infinite" }} />SIGHTLINE AI
            </span>
          </div>
        </Panel>
      </div>
    );
  }
}

// ─── Compressed (single-monitor) ────────────────────────────────
export type StepDetail = "current" | "last-next" | "full";

export interface CompressedPanelProps {
  accent?: AccentName;
  width?: number;
  instruction?: React.ReactNode;
  completed?: string[];
  stepDetail?: StepDetail;
  speaking?: boolean;
  onExpand?: () => void;
  onSend?: () => void;
  onPause?: () => void;
}

export function CompressedPanel(props: CompressedPanelProps) {
  const {
    accent, width = 300, completed = ["Goal Set", "Capture Initial State", "Error Identified: keytar mismatch"],
    stepDetail = "last-next", speaking = true, instruction, onExpand, onSend, onPause,
  } = props;
  const showSteps = stepDetail !== "current";
  const full = stepDetail === "full";
  const shown = full ? completed : [completed[completed.length - 1]];
  return (
    <Themed accent={accent}>
      <Body />
    </Themed>
  );
  function Body() {
    const T = useTheme();
    return (
      <div style={{ position: "relative", width }}>
        <Glow inset="-44px -36px -64px -36px" />
        <Panel width={width} pad={16} gap={13}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={32} radius={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em", lineHeight: 1 }}>SightLine</div>
              <div style={{ marginTop: 3, fontSize: 10.5, color: T.ink3, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, boxShadow: `0 0 6px ${T.accent}` }} />WATCHING · 2s
              </div>
            </div>
            <Spinner size={22} />
            <button className="sl-ctrl" title="Expand" onClick={onExpand} style={{ width: 28, height: 28, border: 0, borderRadius: 8, background: lt(0.05), color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer" }}><IExpand /></button>
          </div>
          {showSteps && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Eyebrow>{full ? "Completed" : "Last completed"}</Eyebrow>
                <span style={{ fontSize: 10, color: T.ink3, fontVariantNumeric: "tabular-nums" }}>{completed.length} done</span>
              </div>
              {shown.map((s) => <MiniStep key={s} label={s} />)}
            </div>
          )}
          <div style={{ borderRadius: 12, background: T.instr, border: `1px solid ${lt(0.07)}`, padding: "12px 13px" }}>
            <Eyebrow>Next step</Eyebrow>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: "#E6EAF0" }}>
              {instruction ?? <>Run <Cmd small>npm&nbsp;run&nbsp;rebuild</Cmd> to rebuild native modules against Electron's Node ABI.</>}
            </div>
          </div>
          {speaking && <SpeakingStrip waveCount={26} height={34} />}
          <ChatInput compact onSend={onSend} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.ink2, padding: "4px 9px", borderRadius: 999, background: lt(0.05), border: `1px solid ${T.border}` }}><IList c={T.ink3} /> {completed.length}</span>
            <div style={{ flex: 1 }} />
            <button className="sl-ctrl" title="Pause" onClick={onPause} style={{ width: 30, height: 30, border: 0, borderRadius: 9, background: "transparent", color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer" }}><IPause /></button>
            <button className="sl-ctrl" title="Assist" style={{ width: 30, height: 30, border: 0, borderRadius: 9, background: "transparent", color: T.accent, display: "grid", placeItems: "center", cursor: "pointer" }}><ISpark /></button>
          </div>
        </Panel>
      </div>
    );
  }
}

// ─── Collapsed bar ──────────────────────────────────────────────
export interface CollapsedBarProps {
  accent?: AccentName;
  width?: number;
  currentStep?: string;
  showStep?: boolean;
  onExpand?: () => void;
  onMic?: () => void;
}

export function CollapsedBar({ accent, width = 320, currentStep = "Run npm run rebuild to rebuild native modules", showStep = true, onExpand, onMic }: CollapsedBarProps) {
  const h = showStep ? 84 : 66;
  return (
    <Themed accent={accent}>
      <Body />
    </Themed>
  );
  function Body() {
    const T = useTheme();
    return (
      <div style={{ position: "relative", width }}>
        <Glow inset="-40px -30px -50px -30px" />
        <div style={{
          position: "relative", zIndex: 1, width, height: h, borderRadius: showStep ? 22 : 999, padding: "0 8px 0 9px",
          background: `${T.glassGrad}, ${T.glassBg}`, backdropFilter: "blur(24px) saturate(1.3)", WebkitBackdropFilter: "blur(24px) saturate(1.3)",
          border: `1px solid ${T.border}`, boxShadow: `0 1px 0 0 ${T.hi} inset, 0 18px 44px -16px rgba(0,0,0,0.7)`,
          display: "flex", alignItems: "center", gap: 11, color: T.ink, fontFamily: T.font,
        }}>
          <Logo size={showStep ? 48 : 44} radius={showStep ? 14 : 999} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            {showStep ? (
              <>
                <div style={{ fontSize: 12.5, lineHeight: 1.3, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentStep}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Waveform count={24} height={14} /><span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: T.accentSoft, flexShrink: 0 }}>SPEAKING</span></div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.accentSoft }}>SPEAKING</span>
                <Waveform count={30} height={18} />
              </>
            )}
          </div>
          <button className="sl-ctrl" title="Voice" onClick={onMic} style={{ width: 34, height: 34, border: 0, borderRadius: "50%", background: "transparent", color: T.ink2, display: "grid", placeItems: "center", cursor: "pointer", alignSelf: showStep ? "flex-start" : "center", marginTop: showStep ? 8 : 0 }}><IMic /></button>
          <button title="Expand" onClick={onExpand} style={{ width: 34, height: 34, border: 0, borderRadius: "50%", background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`, color: T.onAccent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`, alignSelf: showStep ? "flex-start" : "center", marginTop: showStep ? 8 : 0 }}><IExpand c={T.onAccent} /></button>
        </div>
      </div>
    );
  }
}

// ─── Mini orb ───────────────────────────────────────────────────
export interface MiniOrbProps {
  accent?: AccentName;
  size?: number;
  live?: boolean;
  onClick?: () => void;
}

export function MiniOrb({ accent, size = 64, live = true, onClick }: MiniOrbProps) {
  return (
    <Themed accent={accent}>
      <Body />
    </Themed>
  );
  function Body() {
    const T = useTheme();
    return (
      <div onClick={onClick} style={{ position: "relative", width: size + 32, height: size + 32, display: "grid", placeItems: "center", cursor: onClick ? "pointer" : "default" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle, ${ar(T.accentRGB, 0.4)} 0%, transparent 68%)`, filter: "blur(10px)", animation: "sl-bloom 4.5s ease-in-out infinite" }} />
        <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", background: T.logoGrad, boxShadow: `0 0 0 1px ${ar(T.accentRGB, 0.45)} inset, 0 8px 22px -6px ${ar(T.accentRGB, 0.6)}, 0 0 30px -2px ${ar(T.accentRGB, 0.55)}`, display: "grid", placeItems: "center" }}>
          <StarMark size={size * 0.56} />
        </div>
        {live && <span style={{ position: "absolute", right: size * 0.16, top: size * 0.16, width: 14, height: 14, borderRadius: "50%", background: T.accent, border: "2.5px solid #0b0c0f", boxShadow: `0 0 8px ${T.accent}` }} />}
      </div>
    );
  }
}
