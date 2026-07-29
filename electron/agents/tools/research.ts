// search_web — a live lookup, in the same turn.
//
// Before this was a tool, research cost a whole extra tick: the agent set
// needsResearch, the loop tore down the turn, flipped the session to
// "researching", ran the search, stuffed the findings into context, and waited
// for the next poll to actually use them. The user watched a status change and
// heard nothing.
//
// As a tool the model gets the findings mid-turn and speaks once, with the
// answer already in hand.

import type { AgentTool } from "../harness/types";

export const searchWebTool: AgentTool = {
  name: "search_web",
  description:
    "Search the web and get a short factual summary back, in this same turn. Use it when you are blocked on something you cannot know from the screen: an error message you do not recognise, whether a product's menu has moved, the current steps for a task you are unsure of. Quote exact error text plus the product name. Do not use it for things the screenshot already answers.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search query. Include the exact error text and the product name when diagnosing a failure.",
      },
    },
    required: ["query"],
  },
  async run(input, deps) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      return { text: "No query given.", isError: true };
    }
    deps.log(`[tool] search_web "${query.slice(0, 80)}"`);
    // A failed search throws; the runner turns that into an is_error result so
    // the agent can carry on and say something rather than stalling.
    const text = await deps.research(query);
    return { text: text || "The search returned nothing useful." };
  },
};
