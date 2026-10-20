import type { Migration } from '@emanator/shared/server';

export const dreamMigrations: Migration[] = [
  {
    id: '001-dreams',
    sql: `
      CREATE TABLE dream_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL,
        time TEXT NOT NULL
      );
      CREATE TABLE dream_runs (
        id TEXT PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL,
        noted INTEGER NOT NULL DEFAULT 0,
        asked JSONB NOT NULL DEFAULT '[]',
        error TEXT
      );
      CREATE INDEX dream_runs_started ON dream_runs (started_at DESC);
      -- Mail and chats among them: deleted once a Dream has read them (ADR 0009).
      CREATE TABLE dream_journal (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL,
        place TEXT NOT NULL,
        author TEXT NOT NULL,
        tool TEXT,
        text TEXT NOT NULL
      );
    `,
  },
];
