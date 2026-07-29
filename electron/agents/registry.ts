// Mode → agent. The one place the three agents are enumerated.
//
// Adding a fourth mode means writing an agent module and adding it here;
// nothing in claude.ts, main.ts, or the renderer loop needs to know about it.

import type { AgentDescriptor, AppMode } from "../types";
import type { Agent } from "./harness/types";
import { midTurnTools } from "./harness/schema";
import { techSupportAgent } from "./tech-support";
import { trainingAgent } from "./training";
import { teacherAgent } from "./teacher";

const AGENTS: Record<AppMode, Agent> = {
  tech_support: techSupportAgent,
  training: trainingAgent,
  teacher: teacherAgent,
};

export function getAgent(mode: AppMode | null | undefined): Agent {
  return AGENTS[(mode ?? "tech_support") as AppMode] ?? techSupportAgent;
}

export function allAgents(): Agent[] {
  return [techSupportAgent, trainingAgent, teacherAgent];
}

/**
 * What the renderer needs to run this agent's loop. Crosses the IPC bridge —
 * so it carries plain data only, never the skill objects or tool functions.
 */
export function describeAgent(mode: AppMode): AgentDescriptor {
  const agent = getAgent(mode);
  return {
    id: agent.id,
    loop: agent.loop,
    skills: agent.skills.map((s) => s.id),
    tools: midTurnTools(agent).map((t) => t.name),
  };
}
