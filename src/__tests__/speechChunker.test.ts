import { describe, it, expect } from "vitest";
import { InstructionChunker } from "../../electron/speech-chunker";

// Simulates the streamed JSON arriving in arbitrary-sized deltas and collects
// every chunk the chunker emits along the way.
function streamThrough(full: string, sliceSize: number): string[] {
  const chunker = new InstructionChunker();
  const out: string[] = [];
  for (let i = sliceSize; i < full.length + sliceSize; i += sliceSize) {
    for (const c of chunker.push(full.slice(0, i))) out.push(c.text);
  }
  for (const c of chunker.finish()) out.push(c.text);
  return out;
}

const RESPONSE =
  '{"action": "instruct", "instruction": "Nice, that\'s in. Now click the blue Save button, top right. It\'ll open a dialog.", "completed_steps": []}';

describe("InstructionChunker", () => {
  it("splits the instruction into sentences", () => {
    expect(streamThrough(RESPONSE, 7)).toEqual([
      "Nice, that's in.",
      "Now click the blue Save button, top right.",
      "It'll open a dialog.",
    ]);
  });

  it("emits the first sentence before the value closes", () => {
    const chunker = new InstructionChunker();
    // Feed everything up to (but not including) the closing quote.
    const partial = '{"action": "instruct", "instruction": "First one. Second still going';
    const chunks = chunker.push(partial);
    expect(chunks.map((c) => c.text)).toEqual(["First one."]);
    // The tail arrives when the value closes.
    const rest = chunker.push(partial + ' now."}');
    expect(rest.map((c) => c.text)).toEqual(["Second still going now."]);
  });

  it("is robust to any delta size", () => {
    for (const size of [1, 2, 3, 5, 13, 400]) {
      const chunks = streamThrough(RESPONSE, size);
      expect(chunks.join(" ")).toBe(
        "Nice, that's in. Now click the blue Save button, top right. It'll open a dialog.",
      );
    }
  });

  it("unescapes JSON string escapes", () => {
    const resp = '{"instruction": "Click \\"Save As\\" in the menu.\\nThen pick a folder."}';
    expect(streamThrough(resp, 4)).toEqual([
      'Click "Save As" in the menu.',
      "Then pick a folder.",
    ]);
  });

  it("does not split on domain names or abbreviations", () => {
    const resp =
      '{"instruction": "Go to claude.ai and sign in, e.g. with your Google account. Then come back."}';
    expect(streamThrough(resp, 9)).toEqual([
      "Go to claude.ai and sign in, e.g. with your Google account.",
      "Then come back.",
    ]);
  });

  it("emits nothing for an empty instruction (wait)", () => {
    const resp = '{"action": "wait", "instruction": "", "completed_steps": []}';
    expect(streamThrough(resp, 6)).toEqual([]);
  });

  it("flushes an unterminated instruction on finish()", () => {
    const chunker = new InstructionChunker();
    chunker.push('{"instruction": "Stream died midway');
    expect(chunker.finish().map((c) => c.text)).toEqual(["Stream died midway"]);
  });

  it("assigns sequential indexes", () => {
    const chunker = new InstructionChunker();
    const chunks = [
      ...chunker.push('{"instruction": "One. Two. Three."}'),
      ...chunker.finish(),
    ];
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});
