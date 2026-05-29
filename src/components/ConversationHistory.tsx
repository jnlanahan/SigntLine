import { useEffect, useRef } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import type { ConversationTurn } from "../../electron/types";

interface Props {
  turns: ConversationTurn[];
}

export function ConversationHistory({ turns }: Props) {
  const T = useTheme();
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = turns.filter(
    (t) => !(t.role === "user" && t.content.startsWith("Goal:")),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length]);

  if (visible.length === 0) return null;

  return (
    <div className="sl-selectable" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {visible.map((turn, i) => {
        const isUser = turn.role === "user";
        return (
          <div
            key={i}
            style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}
          >
            <div
              style={{
                maxWidth: "85%", padding: "9px 13px",
                fontSize: 13, lineHeight: 1.5,
                ...(isUser
                  ? {
                      background: `linear-gradient(180deg, ${T.accent} 0%, ${T.accentDeep} 100%)`,
                      color: T.onAccent,
                      borderRadius: "14px 14px 4px 14px",
                    }
                  : {
                      background: lt(0.05),
                      color: T.ink,
                      border: `1px solid ${lt(0.08)}`,
                      borderRadius: "14px 14px 14px 4px",
                    }),
              }}
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
