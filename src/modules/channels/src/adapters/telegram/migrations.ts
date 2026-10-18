import type { Migration } from '@emanator/shared/server';

export const telegramMigrations: Migration[] = [
  {
    id: '001-owner',
    sql: `
      CREATE TABLE telegram_owner (
        singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
        user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        paired_at TIMESTAMPTZ NOT NULL
      )
    `,
  },
];
