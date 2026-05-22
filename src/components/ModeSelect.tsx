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
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">
          Choose a mode
        </p>
        <p className="text-xs text-neutral-500">
          SightLine can see your screen in every mode.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => onSelect(m.mode)}
            className="flex items-start gap-3 rounded-md border border-panel-border bg-black/30 px-3 py-2.5 text-left transition hover:border-accent hover:bg-black/50"
          >
            <span className="mt-0.5 text-lg leading-none">{m.icon}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-neutral-100">
                {m.title}
              </span>
              <span className="text-xs leading-snug text-neutral-400">
                {m.blurb}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
