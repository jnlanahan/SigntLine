// sightline/index.ts — public API
import "./sightline.css";

export { SightLineTheme, useTheme } from "./ThemeProvider";
export { makeTheme, waveColor, ACCENTS } from "./theme";
export type { AccentName, AccentDef, SightLineTheme as SightLineThemeTokens } from "./theme";

export {
  Glow, StarMark, Logo, Spinner, Waveform, Eyebrow, Cmd, Check,
  CtrlBtn, ChatInput, SpeakingStrip, StepRow, MiniStep, Panel,
} from "./primitives";

export {
  ModePicker, ExpandedPanel, CompressedPanel, CollapsedBar, MiniOrb, MODES,
} from "./panels";
export type {
  ModePickerProps, ExpandedPanelProps, CompressedPanelProps, CollapsedBarProps, MiniOrbProps,
  SightLineMode, StepDetail, ModeDef,
} from "./panels";
