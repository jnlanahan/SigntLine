interface Props {
  value: number;
  onChange(value: number): void;
}

export function IntervalSlider({ value, onChange }: Props) {
  return (
    <div className="no-drag flex items-center gap-2 text-[11px] text-neutral-400">
      <span>Check every</span>
      <input
        type="range"
        min={5}
        max={60}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-range flex-1"
      />
      <span className="w-7 text-right tabular-nums text-neutral-200">{value}s</span>
    </div>
  );
}
