import type { Migration } from '@emanator/shared/server';

export const conversationMigrations: Migration[] = [
  {
    id: '001-conversations',
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thread_id TEXT,              -- NULL: the Channel's General thread
        session_engine TEXT,         -- opaque Engine session (ADR 0006)
        session_id TEXT,
        model TEXT,
        opened_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        archived_at TIMESTAMPTZ
      );
      -- At most one live Conversation per thread.
      CREATE UNIQUE INDEX conversations_live_thread
        ON conversations (channel, COALESCE(thread_id, ''))
        WHERE archived_at IS NULL;
    `,
  },
  {
    // A name identifies a live Conversation, so an archived one frees its name.
    id: '002-live-names',
    sql: `
      ALTER TABLE conversations DROP CONSTRAINT conversations_name_key;
      CREATE UNIQUE INDEX conversations_live_name
        ON conversations (name)
        WHERE archived_at IS NULL;
    `,
  },
];
