# Definitions live in files, state in SQLite

> **Superseded by [ADR 0007](0007-postgresql-config-and-state.md).** This is the historical decision from the earlier architecture. Structured configuration and runtime state now live in PostgreSQL; Skills and Memory remain files by nature.

Everything the Owner declares (Persona, Routines, Triggers, Capabilities, Areas, Policies) is saved as readable files in a data folder: Markdown with frontmatter for long text such as Routine prompts, YAML for the rest. Skills and Memory are files by nature. The UI reads and writes these files; there is no parallel database. SQLite holds only what changes while the Harness runs: Runs, sessions, message queues, pending Approvals and encrypted OAuth tokens. The aim is configuration that can be versioned with git, backed up easily and moved between installations, which matters for an open-source project.

Conversations count as state, not definitions. They are born in chat, opened by the Owner or the Agent, and change continuously. Routine definitions refer to a Conversation by a stable name (e.g. `briefing`), and the Harness opens it on first delivery if it doesn't exist yet.

SQLite is accessed with Node's built-in `node:sqlite` (Node 24 LTS, where it is no longer flagged experimental) and hand-written SQL. Each feature keeps its own migrations, and a shared runner applies them.

## Consequences

- The Harness must notice hand-edited files and reload them. An invalid file must be reported without stopping everything else.
- Reminders and Routines created by the Agent also become files, so they end up in git history.
