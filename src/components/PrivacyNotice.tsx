interface Props {
  onAccept(): void;
}

export function PrivacyNotice({ onAccept }: Props) {
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3">Before we begin</p>
        <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight text-sl-ink">
          SightLine will watch your screen
        </h2>
      </div>
      <ul className="flex flex-col gap-2.5">
        {[
          <>Screenshots are sent to the <strong className="text-sl-ink font-semibold">Anthropic API</strong> to get your next instruction.</>,
          <>Screenshots are kept in memory only — <strong className="text-sl-ink font-semibold">never written to disk</strong>.</>,
          <>Voice input is sent to the <strong className="text-sl-ink font-semibold">OpenAI Whisper API</strong> for transcription.</>,
          <>Hit <strong className="text-sl-ink font-semibold">Pause</strong> or <strong className="text-sl-ink font-semibold">Stop</strong> at any time to halt capture and API calls.</>,
          <>API keys are stored in the <strong className="text-sl-ink font-semibold">Windows Credential Manager</strong> — not in plain-text files.</>,
        ].map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: "#8FC4EC" }}
            />
            <span className="text-xs leading-relaxed text-sl-ink2">{item}</span>
          </li>
        ))}
      </ul>
      <p
        className="rounded-xl px-3 py-2.5 text-[11px] leading-snug text-sl-ink3"
        style={{ border: "1px solid rgba(244,232,218,0.06)", background: "rgba(244,232,218,0.02)" }}
      >
        Avoid having passwords or sensitive data on screen unless you trust the recipient API.
      </p>
      <button
        onClick={onAccept}
        className="mt-auto self-end rounded-xl px-5 py-2 text-xs font-semibold transition"
        style={{ background: "#8FC4EC", color: "#0d1117", border: 0, cursor: "pointer" }}
      >
        I understand, continue
      </button>
    </div>
  );
}
