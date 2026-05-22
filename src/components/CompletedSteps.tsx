interface Props {
  steps: string[];
  noun?: string;
}

export function CompletedSteps({ steps, noun = "step" }: Props) {
  if (steps.length === 0) return null;
  return (
    <details className="no-drag rounded-md border border-panel-border bg-black/20 px-2 py-1 text-[11px] text-neutral-300">
      <summary className="cursor-pointer select-none text-neutral-400 hover:text-neutral-200">
        {steps.length} {noun}{steps.length === 1 ? "" : "s"} done
      </summary>
      <ol className="sl-scroll mt-1 max-h-24 list-decimal overflow-y-auto pl-5">
        {steps.map((s, i) => (
          <li key={i} className="py-0.5 text-neutral-300">
            {s}
          </li>
        ))}
      </ol>
    </details>
  );
}
