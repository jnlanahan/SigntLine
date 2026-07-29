// The data model, defined once.
//
// Everything persists locally today (see ./store.ts — JSON files under
// %APPDATA%/SightLine/data), but the shapes below are deliberately relational
// and the DDL at the bottom is the Postgres schema that mirrors them. Moving
// to Neon is then: run the DDL, implement the same repository interface
// against it, and hook up auth to populate user_id. No shape changes.
//
// Pure module — no Electron, no fs — so it is unit-testable and importable
// from the renderer.

export type SessionOutcome = "completed" | "abandoned" | "unknown";

/** One coaching session, start to finish. */
export interface SessionRecord {
  id: string;
  // Null until auth exists. Every row carries it now so the migration is a
  // backfill rather than a schema change.
  userId: string | null;
  mode: "tech_support" | "training" | "teacher";
  goal: string;
  startedAt: number;
  endedAt: number | null;
  outcome: SessionOutcome;
  // The goal-evaluation verdict, when the user asked for one.
  verdict: string | null;
  // Denormalized totals — cheap to read for history and analytics without
  // walking every turn.
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  claudeCalls: number;
  steps: SessionStepRecord[];
  turns: SessionTurnRecord[];
}

/** A step in the session's plan and how it went. */
export interface SessionStepRecord {
  idx: number;
  description: string;
  state: "completed" | "current" | "upcoming";
  expectedResult: string | null;
  completedAt: number | null;
}

/** One message in the transcript. */
export interface SessionTurnRecord {
  idx: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

/** Lightweight row for the history list — no transcript, no steps. */
export interface SessionSummary {
  id: string;
  userId: string | null;
  mode: SessionRecord["mode"];
  goal: string;
  startedAt: number;
  endedAt: number | null;
  outcome: SessionOutcome;
  costUsd: number;
  stepsCompleted: number;
}

/**
 * A durable fact the coach learned about this user or their setup. This is
 * what makes it feel like the same person came back — "you're on the Windows
 * app, not the web one" should not have to be re-established every session.
 */
export type MemoryKind =
  | "setup" // their environment: OS, app version, which account
  | "preference" // how they like to be helped
  | "history" // something they did in a previous session
  | "obstacle"; // a problem they hit before, and what fixed it

export interface MemoryFact {
  id: string;
  userId: string | null;
  kind: MemoryKind;
  content: string;
  sourceSessionId: string | null;
  createdAt: number;
  // Touched whenever the fact is surfaced to the agent — drives both ranking
  // and pruning, so facts that never prove useful fade out.
  lastUsedAt: number;
  useCount: number;
  // Facts the user explicitly removed. Kept rather than deleted so the same
  // fact isn't immediately re-learned and re-surfaced.
  archived: boolean;
}

/** A reusable, named plan produced by a Training session. */
export interface TrainingPlan {
  id: string;
  userId: string | null;
  title: string;
  goal: string;
  mode: SessionRecord["mode"];
  steps: string[];
  createdAt: number;
  updatedAt: number;
  sourceSessionId: string | null;
  // How many times this plan has been used to start a session.
  runCount: number;
}

/**
 * Postgres DDL matching the interfaces above. Applied as-is to a Neon
 * database when the app moves off local storage. Kept beside the types on
 * purpose: if one changes and the other doesn't, the drift is visible in the
 * same file rather than across a migrations directory nobody opens.
 */
export const POSTGRES_SCHEMA = `
-- SightLine schema (v1)
-- Apply to a Neon Postgres database:  psql "$DATABASE_URL" -f schema.sql

create extension if not exists "pgcrypto";

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references users(id) on delete cascade,
  mode                text not null check (mode in ('tech_support','training','teacher')),
  goal                text not null,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  outcome             text not null default 'unknown'
                        check (outcome in ('completed','abandoned','unknown')),
  verdict             text,
  cost_usd            numeric(10,4) not null default 0,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  claude_calls        integer not null default 0
);
create index if not exists sessions_user_started_idx
  on sessions (user_id, started_at desc);

create table if not exists session_steps (
  id               bigserial primary key,
  session_id       uuid not null references sessions(id) on delete cascade,
  idx              integer not null,
  description      text not null,
  state            text not null check (state in ('completed','current','upcoming')),
  expected_result  text,
  completed_at     timestamptz,
  unique (session_id, idx)
);

create table if not exists session_turns (
  id          bigserial primary key,
  session_id  uuid not null references sessions(id) on delete cascade,
  idx         integer not null,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null,
  unique (session_id, idx)
);

create table if not exists memory_facts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references users(id) on delete cascade,
  kind               text not null
                       check (kind in ('setup','preference','history','obstacle')),
  content            text not null,
  source_session_id  uuid references sessions(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz not null default now(),
  use_count          integer not null default 0,
  archived           boolean not null default false
);
create index if not exists memory_facts_user_idx
  on memory_facts (user_id, archived, last_used_at desc);

create table if not exists training_plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references users(id) on delete cascade,
  title              text not null,
  goal               text not null,
  mode               text not null,
  steps              jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  source_session_id  uuid references sessions(id) on delete set null,
  run_count          integer not null default 0
);
create index if not exists training_plans_user_idx
  on training_plans (user_id, updated_at desc);
`.trim();
