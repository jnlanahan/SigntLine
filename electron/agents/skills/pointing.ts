// pointing — the glow box on the real screen.
//
// The agent returns a bounding box as fractions of the screenshot; the app
// flashes a glow there on the actual desktop. It only makes sense paired with
// an instruction to click one visible thing, which is why the field is
// restricted to "instruct" turns downstream.

import type { Skill } from "../harness/types";

export const pointingSkill: Skill = {
  id: "pointing",
  systemFragment: `Pointing at things — when an "instruct" tells the user to click or find ONE specific element that is VISIBLE in the latest screenshot (a button, tab, menu item, field), set "highlight" to that element's bounding box as fractions of the screenshot's width and height. The app flashes a glow there on the real screen so the user can find it. Be generous with the box — pad it slightly. Leave it out entirely when there's no single visible target, and always leave it out for anything that isn't an instruct.`,
  outputFields: [
    {
      name: "highlight",
      on: "say",
      schema: {
        type: "object",
        description:
          "Bounding box of the one element to point at, as 0-1 fractions of the screenshot. Omit this field when there is no single visible target, or when this isn't an instruct.",
        properties: {
          x: { type: "number", description: "Left edge, 0-1." },
          y: { type: "number", description: "Top edge, 0-1." },
          w: { type: "number", description: "Width, 0-1." },
          h: { type: "number", description: "Height, 0-1." },
        },
        required: ["x", "y", "w", "h"],
      },
    },
  ],
};
