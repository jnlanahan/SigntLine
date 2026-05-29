# SightLine overlay — React components

Drop-in React components for the SightLine screen-watching overlay. TypeScript,
zero runtime dependencies (just React 18+), themeable accent. Works in Next.js
(app or pages router), Vite, CRA — anywhere React runs. Tailwind-friendly but
not Tailwind-dependent (styling is self-contained inline + one keyframes CSS).

## Install

Copy the `sightline/` folder into your project (e.g. `components/sightline/`).
Requires `react` and `react-dom` ≥ 18.

## Use

```tsx
import { ExpandedPanel, CompressedPanel, CollapsedBar, MiniOrb, ModePicker } from "@/components/sightline";

export default function Overlay() {
  return <ExpandedPanel accent="lime" onSend={() => {}} onPause={() => {}} />;
}
```

Each view is standalone and floats on any dark surface (it renders its own
ambient glow). Position it yourself — e.g. a fixed overlay:

```tsx
<div className="fixed right-6 top-6 z-50">
  <ExpandedPanel accent="lime" />
</div>
```

### Theming

Default accent is **lime** (`#C2E84B`). Four palettes ship: `lime`, `cobalt`,
`rose`, `slate`. Set it per-component via the `accent` prop, or once for a
subtree with the provider:

```tsx
import { SightLineTheme, ExpandedPanel, CollapsedBar } from "@/components/sightline";

<SightLineTheme accent="lime">
  <ExpandedPanel />
  <CollapsedBar />
</SightLineTheme>
```

Add a palette by extending `ACCENTS` in `theme.ts`.

## Components

| Component | Purpose | Key props |
|---|---|---|
| `ModePicker` | Home / launch screen — pick Tech Support · Training · Teacher | `selected`, `onSelect`, `modes` |
| `ExpandedPanel` | Full session panel (dual-monitor) | `mode`, `goal`, `instruction`, `completed`, `context`, `speaking` |
| `CompressedPanel` | Tight single-monitor panel | `stepDetail` (`"current" | "last-next" | "full"`), `completed`, `speaking`, `onExpand` |
| `CollapsedBar` | Slim always-on capsule | `currentStep`, `showStep` |
| `MiniOrb` | Smallest docked state | `size`, `live`, `onClick` |

All panels accept `accent` and the relevant `on*` callbacks (`onSend`,
`onPause`, `onSettings`, `onExpand`, `onMic`, `onSelect`).

Primitives are exported too if you want to compose your own layout:
`Logo`, `Spinner`, `Waveform`, `SpeakingStrip`, `StepRow`, `MiniStep`,
`ChatInput`, `Cmd`, `Eyebrow`, `Panel`, `Glow`, `CtrlBtn`.

## Files

```
sightline/
  index.ts            barrel export (also imports sightline.css)
  theme.ts            accent palettes, tokens, waveColor()
  ThemeProvider.tsx   <SightLineTheme> + useTheme()
  icons.tsx           line icons
  primitives.tsx      atoms + building blocks
  panels.tsx          the five views
  sightline.css       keyframes (waveform / spinner / glow / blink)
  SightLineGallery.tsx  optional demo route
```

## Notes

- The animation keyframes live in `sightline.css`, imported by `index.ts`. If
  your setup doesn't allow importing CSS from a TS file, paste its contents
  into your global stylesheet.
- `ChatInput` is controlled-friendly: pass `value` + `onChange` + `onSend`.
- Components render fixed pixel widths by design (overlay UI). Override with the
  `width` prop where exposed.
