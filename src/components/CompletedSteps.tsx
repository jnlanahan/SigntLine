interface Props {
  steps: string[];
  noun?: string;
}

export function CompletedSteps({ steps, noun = "step" }: Props) {
  if (steps.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-2.5"
      style={{
        borderColor: "rgba(244,232,218,0.08)",
        background: "rgba(244,232,218,0.03)",
      }}
    >
      <p className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3">
        {steps.length} {noun}{steps.length === 1 ? "" : "s"} done
      </p>
      <ol className="sl-scroll flex max-h-28 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span
                className="mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  background: isLast
                    ? "rgba(90,147,199,0.18)"
                    : "rgba(91,208,139,0.18)",
                }}
              >
                {isLast ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: "#8FC4EC",
                      boxShadow: "0 0 6px #8FC4EC",
                      animation: "sl-live-pulse 1.5s ease-out infinite",
                    }}
                  />
                ) : (
                  <CheckIcon />
                )}
              </span>
              <span
                className="leading-snug"
                style={{
                  color: isLast ? "#F4E8DA" : "#7A6E63",
                  textDecoration: isLast ? "none" : "line-through",
                  opacity: isLast ? 1 : 0.75,
                }}
              >
                {s}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path
        d="M1 4.5l2 2 5-5"
        stroke="#5BD08B"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
