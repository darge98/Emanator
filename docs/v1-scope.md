# Emanator — v1 scope

Emanator is an open-source (MIT), self-hosted harness. It runs one always-on personal Agent for one Owner. The Agent acts in response to Events and talks with the Owner over Telegram.

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Architectural decisions are in [docs/adr/](adr/).

## In v1

### Agent and Persona
- There is one Agent.
- Its Persona has a name and free-form personality text, editable from the dashboard in Italian or English.
- Built-in presets (Jarvis, Cortana, Joi) copy their name and personality into the editable fields. The saved Persona has no preset identity or link.
- Presets draw their voices from MCU J.A.R.V.I.S., Halo 1–4 Cortana and Blade Runner 2049 Joi. They include original dialogue examples; their references never assign an identity to the Owner.
- The Persona determines the register and forms of address, adapted to the Owner's explicit preferences. The Agent uses the Owner's name only when supplied in the available context and never invents a name, title or gender. Memory will later carry the learned name across Conversations and resets.
- Saving applies changes from the next Turn; a Turn already in progress completes with its existing instructions.

### Routines
- A Routine is a prompt plus one or more scheduled Triggers: a specific date, an interval or a cron expression. The dashboard offers guided schedules (every day, days of the week, day of the month at a time) that are cron expressions underneath, with raw cron as the advanced option.
- The Agent decides which Faculties, Capabilities and Skills to use.
- Routine names are unique and otherwise free; `general` is allowed too.
- Each Routine picks its own model.
- Every Routine delivers to its own topic, never to General (choosing General may come back later). The topic is the Routine's own Conversation:
  - it is created on the first Run and the Routine keeps it by id;
  - its name is the Routine's name with the reserved `-routine` suffix (`briefing-routine`), and its Telegram title marks it as a Routine. It therefore never collides with General or with topics opened by the Owner or the Agent, and never needs a numeric suffix. A topic opened normally whose name would end in `-routine` gets the numeric suffix instead;
  - renaming the Routine renames the Conversation and the Telegram topic;
  - if the Conversation is archived, the next Run opens a new one with the same name;
  - deleting the Routine archives its Conversation. The Telegram topic stays, and removing it is up to the Owner. A Run still in progress then delivers nothing, and a Run of a renamed Routine uses the new name.
- Each Routine message starts with a header naming the Routine. It then still makes sense if it lands in General because the Owner deleted the target topic (see Conversations).
- Creating, editing or deleting a Routine applies immediately, without restarting the Harness: the scheduler updates its Triggers. A Run already in progress completes.
- Conversation names follow one rule: a name identifies a *live* Conversation. Archiving a Conversation frees its name, so a reopened `briefing-routine` keeps it, and `general` is reserved for the General Conversation.
- A Run may finish without messaging the Owner: its final reply is delivered unless it is exactly `[silent]`. A Heartbeat is just a Routine.
- Each Run has its own Engine session (ADR 0006). What it delivers is handed to the target Conversation on the Owner's next turn there, so replies have that context without the Routine's prompt and Tools entering the Conversation.
- Runs, including Runs of the same Routine, execute in parallel.
- Events that fire while the Harness is down are skipped.

### Conversations (Telegram)
- Each Conversation is a Telegram topic in the private chat with the bot: a "General" topic plus dedicated ones. Both the Owner and the Agent can open a topic.
- A Routine's output lands in its target Conversation, so replies there have that context.
- Deleting a topic from the Telegram app only hides it for the Owner. Checked on 2026-10-15:
  - the bot gets no update;
  - sends to it still succeed, and Telegram reports them as delivered to the topic;
  - the Owner's client shows them in General.

  The Harness therefore can't detect the deletion, and the Conversation stays live. Archiving it is left to the UI.
- Context is reset only by the Owner with `/new`, and is compacted automatically when it grows too large.
- Messages within one Conversation are queued and handled in order.
- Bot commands are in English (`/start`, `/new`, …). The bot answers only the paired Owner chat, using a pairing code shown in the UI.
- Telegram is used in long-polling mode, so no public URL is needed.

### Agent abilities
- **Faculties:** web search and fetch, files confined to the working folder, and opening Conversations. There is no shell in v1.
- **Capabilities:** remote MCP servers only.
  - There is one Capability per account, each assigned to an Area (Personal, Work, Volunteering, …).
  - The Harness acts as an MCP OAuth client. It supports both dynamic client registration and pre-registered client ID/secret.
- **Skills:** instruction-only SKILL.md packages, created, edited or uploaded from the UI.

### Control
- Each Tool has a Policy: *allow*, *ask* or *deny*.
  - One Policy per Tool, shared by Conversations and Routines.
  - Defaults come from MCP tool annotations: read-only starts as *allow*, write or destructive as *ask*.
  - Faculties have no annotations, so their defaults are fixed: web search, web fetch, reading files and opening Conversations start as *allow*; writing files as *ask*. Web fetch on *allow* can leak data; that risk is accepted until a Capability holds private data, and is reviewed when Google arrives.
  - Files use the Engine's own tools. Reading, finding and searching files can be *allow* or *deny* but not *ask*, because the Engine reads inside the working folder without asking (ADR 0001). Nothing outside the working folder can be reached, whatever the Policy.
  - The Owner can change Policies only in the UI.
- Approvals arrive on Telegram as Yes/No buttons, with no "always" option, in the topic of the turn that asked: the Conversation's, or the Routine's for a Run.
  - Each is repeated once after 15 minutes and expires 15 minutes later; expiry counts as a denial.
  - While one is pending, the Owner's new messages in that topic wait in the queue.
  - Approvals still pending when the Harness stops become expired, because their turn ended with the process; their buttons then answer that the request expired.

### Google (Gmail and Calendar)
- Start with Google's official remote MCP servers, read-only.
- **Plan B:** if the Owner's account isn't admitted to the preview, run `workspace-mcp` as a local MCP server inside the Sandbox. The Sandbox then enters v1, still without the shell.

### Engine and quota
- The Claude Agent SDK runs with the Owner's subscription token (`claude setup-token`) or an API key, supplied via `.env`.
- There is a default model, and Routines and Conversations can override it.
- When the usage limit is hit, Runs wait for the reset and the Owner gets one notice, in the topic of the Routine that hit it, with the time Runs resume. Runs failing together share one wait and one notice, even when the Engine doesn't say when the quota resets. Runs started meanwhile wait without calling the Engine. A Run gives up after three resets, and stopping the Harness fails the Runs still waiting.

### UI
- A React and Vite single-page dashboard is served by the Harness on `127.0.0.1:3000`, with no authentication in v1.
- Currently covers:
  - Persona configuration: choose a preset, edit the name and personality, then explicitly save or cancel;
  - Routines: list with next Run, create, edit, delete, "run now" and Run history (status, origin, duration, Tools, error). Run transcripts are still to come;
  - Faculties and Policies: every Faculty Tool with its Policy, offering only the Policies it can enforce. The choices are saved together with one Save button, and a Tool set to its default goes back to it.

  The language choice is stored locally in the browser.
- Remaining v1 pages:
  - Areas;
  - Capabilities, including the OAuth "Connect" button;
  - Skills;
  - Run transcripts in the Routine history;
  - Conversations;
  - Telegram pairing.
- The dashboard language is Italian or English.

### Failures
A failed Run is always logged and detailed in the Run history. When the Engine reports the failure, the Owner also gets a notice in the Routine's topic.

## Architecture

- **Modular monolith** in a pnpm TypeScript monorepo, with application entry points under `src/apps` and modules under `src/modules`, organised as vertical feature slices named after glossary terms. Each module holds domain, server API and UI ([ADR 0005](adr/0005-vertical-feature-slices.md)).
- **Process:** one Fastify Node process runs the API, scheduler and Telegram bot, and serves the built Vite + React SPA.
- **Engine:** a swappable port; the first adapter is the Claude Agent SDK ([ADR 0001](adr/0001-swappable-engine-agent-sdk-with-owner-subscription.md)).
- **Portable abilities:** Faculties, Capabilities (MCP) and Skills. Plugins are only packaging ([ADR 0002](adr/0002-portable-agent-abilities-plugins-are-packaging.md)).
- **Storage:** PostgreSQL is the sole application database for structured configuration and runtime state. Skills and Memory remain files; Claude Agent SDK transcripts remain under `./data/claude` and the Engine's working folder is `./data/workspace`, with opaque session references in PostgreSQL ([ADR 0007](adr/0007-postgresql-config-and-state.md)). ADR 0003 records the superseded file/SQLite decision.
- **Containers:** the Harness container holds the secrets. A single Sandbox container runs local and third-party code, with one unprivileged Linux user per process ([ADR 0004](adr/0004-separate-harness-and-sandbox.md)).
- **Hosting:** Docker, starting on a local machine; a VPS or home server later.
- **Language:** code and docs in English; UI in Italian and English.

## Later waves

- Dashboard polish found in the Routines review (October 2026):
  - validation errors from the server are in English, also in the Italian UI; Run errors in the history are raw Engine text;
  - accessibility: focus moves to the editor when it opens and back after it closes, and history toggles get `aria-controls`;
  - the Owner is told about every failed Run in Telegram, not only those the Engine reports.
- Two Policy saves at the same moment can collide, and the second fails with a server error instead of replacing the first. Unlikely with one Owner; a lock at the start of the transaction fixes it.
- Routine names made only of non-Latin letters (e.g. `日本`) all slug to `topic`, so only one of them can exist.

- Webhook Triggers, through a tunnel that exposes only `/webhook`, and filtering of external events.
- Reminders and self-scheduling: the Agent creates one-off Reminders freely, and recurring Routines with the Owner's confirmation. This enables calendar-aware preparation reminders through a "planner" Routine.
- Memory: Markdown notes curated by the Agent (file based).
- Sandbox with the shell Faculty (on *ask*), local MCP servers and Skills with scripts.
- Plugin installation from Claude Code marketplaces.
- Injecting new messages into the turn already in progress, instead of queueing them.
- Cancelling a turn (a Stop button, cancelling a Run). The Engine must first check for a signal that was aborted before the turn started, which it currently ignores, and report a dedicated `cancelled` failure.
- Catching up on Events missed while the Harness was down.
- Handling overlapping Runs of the same Routine. In v1 they run in parallel, which is a known issue.
- Restricting Capabilities per Routine, and Policies that a Routine overrides.
- Approvals for Tools that execute real actions, with the patterns in [legacy-ideas.md](legacy-ideas.md#approvals-patterns-to-adopt): binding to a hash of the content shown, atomic *pending* → *executing*, idempotent ids, ETag preconditions, and *uncertain outcome* at startup.
- Usage metrics panel: quota per window (five-hour, seven-day), turns, and estimated cost per Routine and Conversation, built on the Engine's `usage.limit` events.
- UI authentication and deployment to a VPS. On Linux hosts the `./data` bind mount must be writable by the container's `node` user (uid 1000). Docker creates a missing `./data` as root, so the Harness would crash-loop; Docker Desktop on macOS hides this.
- Multiple Agents, and project workflows with dedicated development containers.
- The ideas carried over from the first prototype, in [legacy-ideas.md](legacy-ideas.md):
  - briefing behaviours, Action requests and commitments;
  - a Decider for typed micro-decisions;
  - Memory with confirmed facts and an initial interview;
  - 👍/👎 feedback and `/perché`;
  - budget alerts, quiet hours and urgency rules;
  - Approval execution patterns;
  - the panel's design tokens;
  - the Persona prompts and their fixed rules.

## Risks to check first

- **Subscription token with the Agent SDK:** it works end to end (smoke run on 2026-10-14, see ADR 0001), but it remains a grey area in Anthropic's terms.
- **Telegram topics opened by the bot:** still to confirm that the Owner can write inside them while users are not allowed to create topics, and that the bot can rename them (Routine renames; the Bot API documents `editForumTopic` for private chats).
- **Google official MCP servers:** they are in Developer Preview, and it is unverified whether a personal @gmail.com account is accepted. An unverified Google OAuth app with Gmail scopes must be set to "In production" to avoid 7-day token expiry.
- **Built-in Personas named after real characters** (Jarvis, Cortana, Joi): trademark and copyright risk once the project is public.
