import { useTheme } from "../design/ThemeProvider";
import { Eyebrow, StepRow } from "../design/primitives";

interface Props {
  steps: string[];
  noun?: string;
}

export function CompletedSteps({ steps, noun = "step" }: Props) {
  if (steps.length === 0) return null;
  const T = useTheme();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>Completed</Eyebrow>
        <span style={{ fontSize: 11, color: T.ink3, fontVariantNumeric: "tabular-nums" }}>
          {steps.length} {noun}{steps.length === 1 ? "" : "s"} done
        </span>
      </div>
      <ol className="sl-scroll" style={{ display: "flex", maxHeight: 200, flexDirection: "column", gap: 6, overflowY: "auto", paddingRight: 2 }}>
        {steps.map((s, i) => (
          <li key={i}>
            <StepRow label={s} dim={i < steps.length - 1} />
          </li>
        ))}
      </ol>
    </div>
  );
}
