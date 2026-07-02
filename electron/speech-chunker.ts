// Incremental sentence chunker for streamed JSON instructions.
//
// As Claude's response streams in, this extracts the "instruction" string
// value and emits it sentence by sentence, so TTS can start speaking the
// first sentence while the rest of the response is still being generated.
// This is the standard voice-agent pattern (pipecat/LiveKit "sentence
// aggregation"): time-to-first-audio collapses from "full response + full
// synthesis" to "first sentence + first synthesis".
//
// Pure module — no Electron/SDK imports — so it is unit-testable from the
// renderer test suite and usable from the main process.

export interface SpeechChunk {
  text: string;
  index: number;
}

// Words that end with a period without ending a sentence. Compared lowercase,
// with trailing dots stripped ("e.g." → "e.g").
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "vs",
  "etc",
  "mr",
  "mrs",
  "ms",
  "dr",
  "st",
  "approx",
  "min",
  "sec",
]);

const VALUE_START_RE = /"instruction"\s*:\s*"/;

export class InstructionChunker {
  private valueStart = -1;
  private decoded = "";
  private closed = false;
  private emitted = 0; // chars of `decoded` already emitted
  private index = 0;
  private finished = false;

  /**
   * Feed the full accumulated stream text so far. Returns any newly
   * completed sentence chunks (may be empty). Safe to call repeatedly.
   */
  push(accumulated: string): SpeechChunk[] {
    if (this.finished || this.closed) return [];
    if (this.valueStart < 0) {
      const m = VALUE_START_RE.exec(accumulated);
      if (!m) return [];
      this.valueStart = m.index + m[0].length;
    }
    this.decode(accumulated);
    const chunks = this.takeCompleteSentences();
    if (this.closed) chunks.push(...this.flushTail());
    return chunks;
  }

  /** Stream ended — flush whatever remains as a final chunk. */
  finish(): SpeechChunk[] {
    if (this.finished) return [];
    this.finished = true;
    return this.flushTail();
  }

  // Decode the JSON string value from valueStart up to the closing quote,
  // stopping cleanly at an incomplete trailing escape sequence.
  private decode(raw: string): void {
    let out = "";
    let i = this.valueStart;
    while (i < raw.length) {
      const c = raw[i];
      if (c === '"') {
        this.closed = true;
        break;
      }
      if (c === "\\") {
        if (i + 1 >= raw.length) break; // escape split across deltas — wait
        const e = raw[i + 1];
        if (e === "u") {
          if (i + 6 > raw.length) break; // incomplete \uXXXX — wait
          const code = Number.parseInt(raw.slice(i + 2, i + 6), 16);
          out += Number.isNaN(code) ? "" : String.fromCharCode(code);
          i += 6;
        } else {
          if (e === "n" || e === "t" || e === "r") out += " ";
          else if (e === "b" || e === "f") out += "";
          else out += e; // \" \\ \/ and anything else → literal char
          i += 2;
        }
        continue;
      }
      out += c;
      i++;
    }
    this.decoded = out;
  }

  // Emit every sentence whose end is confirmed by trailing whitespace.
  // The tail (a possibly-incomplete sentence) is held back until the value
  // closes or the stream finishes.
  private takeCompleteSentences(): SpeechChunk[] {
    const chunks: SpeechChunk[] = [];
    let searchFrom = this.emitted;
    for (let i = Math.max(searchFrom, 0); i < this.decoded.length - 1; i++) {
      const c = this.decoded[i];
      if (c !== "." && c !== "!" && c !== "?") continue;
      // Absorb runs of terminal punctuation and closing quotes/parens.
      let end = i + 1;
      while (end < this.decoded.length && /[.!?"')\]]/.test(this.decoded[end])) {
        end++;
      }
      // Only a confirmed boundary if whitespace follows.
      if (end >= this.decoded.length || !/\s/.test(this.decoded[end])) {
        i = end - 1;
        continue;
      }
      if (c === "." && this.isAbbreviation(i)) {
        i = end - 1;
        continue;
      }
      const text = this.decoded.slice(this.emitted, end).trim();
      if (text.length > 0) {
        chunks.push({ text, index: this.index++ });
      }
      this.emitted = end;
      i = end - 1;
      searchFrom = end;
    }
    return chunks;
  }

  private flushTail(): SpeechChunk[] {
    const tail = this.decoded.slice(this.emitted).trim();
    this.emitted = this.decoded.length;
    if (tail.length === 0) return [];
    return [{ text: tail, index: this.index++ }];
  }

  // The word immediately before a "." — if it's a known abbreviation, the
  // period doesn't end the sentence ("e.g. the Save button").
  private isAbbreviation(dotIndex: number): boolean {
    let start = dotIndex - 1;
    while (start >= 0 && !/\s/.test(this.decoded[start])) start--;
    const word = this.decoded
      .slice(start + 1, dotIndex)
      .toLowerCase()
      .replace(/\.+$/, "");
    return ABBREVIATIONS.has(word);
  }
}
