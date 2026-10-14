# Definitions live in files, state in SQLite

Everything the Owner declares (Persona, Routines, Triggers, Capabilities, Areas, Policies) is saved as readable files in a data folder: Markdown with frontmatter for long text such as Routine prompts, YAML for the rest. Skills and Memory are files by nature. The UI reads and writes these files; there is no parallel database. SQLite holds only what changes while the Harness runs: Runs, sessions, message queues, pending Approvals and encrypted OAuth tokens. The aim is configuration that can be versioned with git, backed up easily and moved between installations, which matters for an open-source project.

## Consequences

- The Harness must notice hand-edited files and reload them. An invalid file must be reported without stopping everything else.
- Reminders and Routines created by the Agent also become files, so they end up in git history.
