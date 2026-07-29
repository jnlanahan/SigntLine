// Deciding whether the coach is about to say something it already said.
//
// Pure module so the rules are unit-testable — this is a place where being
// slightly wrong in either direction is expensive. Too loose and the coach
// repeats itself out loud (the user hears the same sentence three turns
// running); too strict and it swallows a genuinely new instruction, which is
// the historical failure mode this app cares most about: going silent.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether two whole instructions are the same message. */
export function instructionsAreSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * A repeat is only worth suppressing if it's long enough to be a real
 * instruction. Short connective sentences ("Go ahead.", "Perfect.") appear
 * inside plenty of unrelated turns and must stay speakable.
 */
export const MIN_REPEAT_CHARS = 25;

/**
 * Whether one streamed sentence is something the coach already said on its
 * previous turn.
 *
 * Deliberately a containment check rather than an exact match. The model's
 * repeats usually re-emit ONE sentence of a longer previous instruction — "Go
 * ahead and click 'Something else'" arrives as the tail of a two-sentence turn,
 * then alone on the next turn — so comparing whole instructions misses them,
 * which is exactly how the same line got spoken twice in testing.
 */
export function isRepeatedSentence(sentence: string, previous: string): boolean {
  const a = normalize(sentence);
  const b = normalize(previous);
  if (!a || !b) return false;
  if (a.length < MIN_REPEAT_CHARS) return false;
  return b.includes(a);
}
