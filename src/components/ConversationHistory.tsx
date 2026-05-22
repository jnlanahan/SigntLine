import { useEffect, useRef } from "react";
import type { ConversationTurn } from "../../electron/types";

interface Props {
  turns: ConversationTurn[];
}

export function ConversationHistory({ turns }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = turns.filter(
    (t) => !(t.role === "user" && t.content.startsWith("Goal:")),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length]);

  if (visible.length === 0) return null;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-300">
        <span className="group-open:hidden">▶ Chat ({visible.length})</span>
        <span className="hidden group-open:inline">▼ Chat</span>
      </summary>
      <div className="sl-selectable mt-1.5 flex max-h-48 flex-col gap-1.5 overflow-y-auto sl-scroll pr-0.5">
        {visible.map((turn, i) => (
          <div
            key={i}
            className={`rounded px-2 py-1.5 text-xs leading-snug ${
              turn.role === "user"
                ? "ml-4 bg-white/5 text-neutral-300"
                : "mr-4 bg-accent/10 text-neutral-100"
            }`}
          >
            <span className="mb-0.5 block text-[9px] uppercase tracking-wider opacity-50">
              {turn.role === "user" ? "You" : "SightLine"}
            </span>
            {turn.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </details>
  );
}
