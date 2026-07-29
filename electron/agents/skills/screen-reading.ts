// screenReading — the zoom lens.
//
// Pure tooling: no output fields, no context, one prompt paragraph telling the
// agent when reaching for it is worth the round trip. The tool itself is in
// ../tools/screen.ts.

import type { Skill } from "../harness/types";
import { readScreenRegionTool } from "../tools/screen";

export const screenReadingSkill: Skill = {
  id: "screenReading",
  systemFragment: `Looking closer — the screenshot you get is downscaled to keep it cheap, so small text is often unreliable. When something you need to read is too small to be sure of — an error message, a field label, a status line, a value in a table — call read_screen_region with that part of the screen and you'll get it back much sharper. Reading an error wrong is worse than taking a moment to look properly. Don't use it on text you can already read.`,
  tools: [readScreenRegionTool],
};
