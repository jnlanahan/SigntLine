import type { AppMode } from "../lib/api";

interface Props {
  onSelect(mode: AppMode): void;
}

interface ModeCard {
  mode: AppMode;
  title: string;
  blurb: string;
  icon: string;
}

const MODES: ModeCard[] = [
  {
    mode: "tech_support",
    title: "Tech Support",
    blurb: "Walks you through a task step by step while watching your screen.",
    icon: "🛠",
  },
  {
    mode: "training",
    title: "Training",
    blurb: "Build a structured training plan together as you demonstrate it on screen.",
    icon: "📋",
  },
  {
    mode: "teacher",
    title: "Teacher",
    blurb: "Learn a subject from sources you choose together — a PDF, a paper, a site.",
    icon: "🎓",
  },
];

export function ModeSelect({ onSelect }: Props) {
  return (
    <div className="no-drag flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-sl-ink3">
          Choose a mode
        </p>
        <p className="text-xs text-sl-ink3">
          SightLine can see your screen in every mode.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {MODES.map((m) => (
          <ModeCard key={m.mode} card={m} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function ModeCard({ card, onSelect }: { card: ModeCard; onSelect(m: AppMode): void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.mode)}
      className="flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition"
      style={{
        borderColor: "rgba(244,232,218,0.08)",
        background: "rgba(244,232,218,0.03)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(143,196,236,0.35)";
        (e.currentTarget as HTMLButtonElement).style.background  = "rgba(90,147,199,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,232,218,0.08)";
        (e.currentTarget as HTMLButtonElement).style.background  = "rgba(244,232,218,0.03)";
      }}
    >
      <span className="mt-0.5 text-lg leading-none">{card.icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold tracking-tight text-sl-ink">{card.title}</span>
        <span className="text-xs leading-snug text-sl-ink2">{card.blurb}</span>
      </span>
    </button>
  );
}
