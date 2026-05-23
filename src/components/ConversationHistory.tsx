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
    <div className="sl-selectable flex flex-col gap-1.5">
      {visible.map((turn, i) => {
        const isUser = turn.role === "user";
        return (
          <div
            key={i}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[85%] px-3 py-2 text-[13px] leading-snug"
              style={
                isUser
                  ? {
                      background: "linear-gradient(180deg, #8FC4EC 0%, #5A93C7 100%)",
                      color: "#0d1117",
                      borderRadius: "14px 14px 4px 14px",
                    }
                  : {
                      background: "rgba(244,232,218,0.05)",
                      color: "#F4E8DA",
                      border: "1px solid rgba(244,232,218,0.08)",
                      borderRadius: "14px 14px 14px 4px",
                    }
              }
            >
              {turn.content}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
