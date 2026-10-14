import type { Migration } from '@emanator/shared/server';

export const telegramMigrations: Migration[] = [
  {
    id: '001-owner',
    sql: `
      CREATE TABLE telegram_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        paired_at TEXT NOT NULL
      )
    `,
  },
];
