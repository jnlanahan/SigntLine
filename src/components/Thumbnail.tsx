import type { CaptureFrame } from "../lib/api";

interface Props {
  frame: CaptureFrame | null;
}

export function Thumbnail({ frame }: Props) {
  if (!frame) {
    return (
      <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border border-panel-border bg-black/30 text-[10px] text-neutral-500">
        no frame
      </div>
    );
  }
  const time = new Date(frame.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-md border border-panel-border bg-black/30">
      <img
        src={frame.dataUrl}
        alt="last capture"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[9px] text-neutral-200 opacity-0 transition group-hover:opacity-100">
        {time}
      </div>
    </div>
  );
}
