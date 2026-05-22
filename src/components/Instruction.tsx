import { useEffect, useRef, useState } from "react";

interface Props {
  instruction: string;
  status: string;
  done: boolean;
  error: string | null;
  researchQuery?: string | null;
}

// Soft typewriter reveal — caps at ~140 chars so longer responses don't
// drag, and gracefully skips animation for unchanged text.
function useTypewriter(text: string): string {
  const [shown, setShown] = useState(text);
  const lastRef = useRef(text);

  useEffect(() => {
    if (text === lastRef.current) return;
    lastRef.current = text;
    if (!text) {
      setShown("");
      return;
    }
    let i = 0;
    setShown("");
    const stepSize = Math.max(2, Math.ceil(text.length / 60));
    const id = window.setInterval(() => {
      i += stepSize;
      if (i >= text.length) {
        setShown(text);
        window.clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, 16);
    return () => window.clearInterval(id);
  }, [text]);

  return shown;
}

export function Instruction({ instruction, status, done, error, researchQuery }: Props) {
  const display = useTypewriter(instruction);

  if (error) {
    return (
      <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
        {error}
      </div>
    );
  }
  if (done) {
    return (
      <div className="sl-selectable animate-fade-in rounded-md border border-watching/40 bg-watching/10 px-3 py-2.5 text-sm leading-snug text-watching">
        <span className="mr-1">✓</span>
        {instruction || "Task complete."}
      </div>
    );
  }
  if (status === "researching") {
    return (
      <div className="rounded-md border border-thinking/40 bg-thinking/10 px-3 py-2 text-sm text-thinking">
        Looking something up…
        {researchQuery && (
          <span className="mt-0.5 block text-xs text-neutral-400">"{researchQuery}"</span>
        )}
        <span className="mt-1 block text-xs text-neutral-500">
          Resume when you have the info.
        </span>
      </div>
    );
  }
  if (status === "clarifying") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-panel-border bg-black/30 px-3 py-2 text-sm text-neutral-300">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-thinking border-t-transparent spin-soft" />
        Setting up your session…
      </div>
    );
  }
  if (status === "thinking" && !instruction) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-panel-border bg-black/30 px-3 py-2 text-sm text-neutral-300">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-thinking border-t-transparent spin-soft" />
        Thinking…
      </div>
    );
  }
  if (!instruction) {
    return (
      <div className="rounded-md border border-panel-border bg-black/20 px-3 py-2 text-sm text-neutral-400">
        Tell SightLine what you want to do, then start a session.
      </div>
    );
  }
  return (
    <div className="sl-selectable animate-fade-in rounded-md border border-panel-border bg-black/30 px-3 py-2.5 text-sm leading-snug text-neutral-50">
      {display}
      {display.length < instruction.length && (
        <span className="ml-0.5 inline-block w-1 animate-pulse bg-neutral-400" />
      )}
    </div>
  );
}
