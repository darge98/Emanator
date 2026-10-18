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
];
