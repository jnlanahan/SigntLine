import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ISupport, IClipboard, IChevron } from "../design/icons";
import { ar, lt } from "../design/theme";
import type { AppMode } from "../lib/api";

interface Props {
  onSelect(mode: AppMode): void;
  onSettings?(): void;
}

interface ModeCard {
  mode: AppMode;
  title: string;
  blurb: string;
  Icon: (p: { c?: string }) => JSX.Element;
}

// Teacher mode is deliberately absent for now: Training absorbed the "teach
// me" job as a multi-session curriculum coach. The teacher agent still exists
// in electron/agents/ and comes back by re-adding a card here.
const MODES: ModeCard[] = [
  {
    mode: "tech_support",
    title: "Tech Support",
    blurb: "Walks you through a task step by step while watching your screen.",
    Icon: ISupport,
  },
  {
    mode: "training",
    title: "Training",
    blurb: "SightLine builds a training plan with you, then coaches you through it session by session.",
    Icon: IClipboard,
  },
];

export function ModeSelect({ onSelect }: Props) {
  const T = useTheme();
  return (
    <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <Eyebrow>Choose a mode</Eyebrow>
        <div style={{ marginTop: 5, fontSize: 12.5, color: T.ink2 }}>
          SightLine can see your screen in every mode.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MODES.map((m) => (
          <ModeCardRow key={m.mode} card={m} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function ModeCardRow({ card, onSelect }: { card: ModeCard; onSelect(m: AppMode): void }) {
  const T = useTheme();
  const { Icon } = card;

  return (
    <div
      className="sl-card no-drag"
      onClick={() => onSelect(card.mode)}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "12px 13px", borderRadius: 13, cursor: "pointer",
        background: lt(0.035),
        border: `1px solid ${lt(0.08)}`,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = ar(T.accentRGB, 0.08);
        el.style.borderColor = ar(T.accentRGB, 0.28);
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = lt(0.035);
        el.style.borderColor = lt(0.08);
      }}
    >
      <span style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        display: "grid", placeItems: "center",
        background: lt(0.05), color: T.ink2,
        border: `1px solid ${lt(0.08)}`,
      }}>
        <Icon />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 650, color: T.ink, letterSpacing: "-0.01em" }}>
          {card.title}
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: T.ink2 }}>
          {card.blurb}
        </span>
      </span>
      <span style={{ color: T.ink3, alignSelf: "center", flexShrink: 0 }}>
        <IChevron />
      </span>
    </div>
  );
}
