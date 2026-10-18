import type { Migration } from '@emanator/shared/server';

export const routineMigrations: Migration[] = [
  {
    id: '001-routines',
    sql: `
      CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,   -- names compare by slug
        prompt TEXT NOT NULL,
        model TEXT,
        dedicated_topic BOOLEAN NOT NULL,
        conversation_id TEXT,        -- the Routine's own topic, once opened
        enabled BOOLEAN NOT NULL,
        triggers JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        session_engine TEXT,         -- opaque Engine session (ADR 0006)
        session_id TEXT,
        tools JSONB NOT NULL DEFAULT '[]',
        conversation_id TEXT,
        error TEXT
      );
      CREATE INDEX routine_runs_routine ON routine_runs (routine_id, started_at DESC);
    `,
  },
];
