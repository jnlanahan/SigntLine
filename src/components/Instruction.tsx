interface Props {
  instruction: string;
  status: string;
  done: boolean;
  error: string | null;
  researchQuery?: string | null;
}

export function Instruction({ instruction, status, done, error, researchQuery }: Props) {
  if (error) {
    return (
      <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
        {error}
      </div>
    );
  }
  if (done) {
    return (
      <div className="rounded-md border border-watching/40 bg-watching/10 px-3 py-2 text-sm text-watching">
        ✓ Task complete. {instruction}
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
    <div className="animate-fade-in rounded-md border border-panel-border bg-black/30 px-3 py-2.5 text-sm leading-snug text-neutral-50">
      {instruction}
    </div>
  );
}
