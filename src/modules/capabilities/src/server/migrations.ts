import type { Migration } from '@emanator/shared/server';

export const capabilityMigrations: Migration[] = [
  {
    id: '001-capabilities',
    sql: `
      -- Secret columns hold values sealed by SecretBox, never plaintext.
      CREATE TABLE capabilities (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]',
        enabled BOOLEAN NOT NULL,
        client_id TEXT,
        client_secret TEXT,
        -- What dynamic client registration returned.
        client_information TEXT,
        tokens TEXT,
        status TEXT NOT NULL DEFAULT 'disconnected'
          CHECK (status IN ('disconnected', 'connected', 'needs-auth', 'error')),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `,
  },
  {
    id: '002-tools-and-authorizations',
    sql: `
      -- The Tools a server listed last time, so Policies and the dashboard work while it is offline.
      CREATE TABLE capability_tools (
        capability_id TEXT NOT NULL REFERENCES capabilities (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema JSONB NOT NULL,
        hints JSONB NOT NULL,
        PRIMARY KEY (capability_id, name)
      );
      -- Authorizations the Owner started in the browser and has not finished yet.
      CREATE TABLE capability_authorizations (
        state TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL REFERENCES capabilities (id) ON DELETE CASCADE,
        code_verifier TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
  },
  {
    id: '003-catalog',
    sql: `
      -- The catalog entry a Capability was made from; each entry is connected once.
      ALTER TABLE capabilities ADD COLUMN catalog_id TEXT UNIQUE;
    `,
  },
];
