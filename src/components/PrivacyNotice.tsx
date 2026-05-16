interface Props {
  onAccept(): void;
}

export function PrivacyNotice({ onAccept }: Props) {
  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm text-neutral-200">
      <h2 className="text-base font-semibold text-white">
        Before we start watching your screen
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-xs text-neutral-300">
        <li>
          SightLine captures screenshots of your selected display and sends them
          to the <strong>Anthropic API</strong> to get the next instruction.
        </li>
        <li>
          Screenshots are kept in memory only — they are{" "}
          <strong>never written to disk</strong>.
        </li>
        <li>
          Voice input, when used, is sent to the <strong>OpenAI Whisper API</strong>{" "}
          for transcription.
        </li>
        <li>
          You can hit <strong>Pause</strong> or <strong>Stop</strong> at any time
          to immediately halt all capture and API calls.
        </li>
        <li>
          API keys are stored in the Windows Credential Manager via keytar — not
          in plain-text files.
        </li>
      </ul>
      <p className="text-[11px] text-neutral-500">
        Avoid having sensitive material (passwords, private data) on screen
        unless you trust the recipient API.
      </p>
      <button
        onClick={onAccept}
        className="mt-auto self-end rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white"
      >
        I understand, continue
      </button>
    </div>
  );
}
