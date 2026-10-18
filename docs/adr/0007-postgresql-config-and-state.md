# PostgreSQL stores structured configuration and runtime state

Use one PostgreSQL 18 database as the application's sole database for structured configuration and runtime state. This includes the editable Persona (name and free-form personality), Conversations, Telegram pairing and opaque Engine session references. Presets are built-in source data; selecting one copies its name and personality into the Persona, and no preset identifier is persisted. Conversation message processing is in memory. The Claude Agent SDK owns transcript files under `./data/claude`; the Engine's working folder is `./data/workspace`. PostgreSQL stores opaque session references. Skills and Memory remain files because they are naturally authored and consumed as documents.

The Harness and PostgreSQL run as separate Compose services. PostgreSQL uses a durable named volume; the Harness mounts `./data` for Engine session files. Native development connects through `DATABASE_URL`; Compose supplies the Harness connection from `POSTGRES_PASSWORD`. Tests use `TEST_DATABASE_URL` and isolated schemas.

This replaces [ADR 0003](0003-definitions-in-files-state-in-sqlite.md), which records the earlier file-based definitions and SQLite state decision.

The Owner chose a database-backed configuration UI and accepted PostgreSQL's additional local service and operational cost. A single relational store gives the UI and runtime one persistence model for structured configuration and state.

## Considered options

- **Structured files plus PostgreSQL state:** keeps configuration easy to diff in git, but requires the UI and runtime to coordinate edits across two storage formats.

## Consequences

- PostgreSQL is required for development, tests and deployment; its Compose volume is the durable store.
- Migrations are owned and applied by feature modules.
- PostgreSQL is backed up as the structured configuration and runtime store. Skills and Memory are backed up as files, while Claude transcripts and workspaces remain in the Harness data directory.
