import type { Migration } from '@emanator/shared/server';

export const policyMigrations: Migration[] = [
  {
    id: '001-policies-and-approvals',
    sql: `
      -- Only the Owner's choices; every other Tool has its default Policy.
      CREATE TABLE tool_policies (
        tool TEXT PRIMARY KEY,
        policy TEXT NOT NULL CHECK (policy IN ('allow', 'ask', 'deny')),
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        input JSONB NOT NULL,
        thread_id TEXT,
        status TEXT NOT NULL,
        message_ids JSONB NOT NULL DEFAULT '[]',
        requested_at TIMESTAMPTZ NOT NULL,
        decided_at TIMESTAMPTZ
      );
      CREATE INDEX approvals_pending ON approvals (requested_at) WHERE status = 'pending';
    `,
  },
  {
    id: '002-approval-messages',
    sql: 'ALTER TABLE approvals ADD COLUMN message TEXT;',
  },
];
