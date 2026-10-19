# Emanator — v1 scope

Emanator is an open-source (MIT), self-hosted harness. It runs one always-on personal Agent for one Owner. The Agent acts in response to Events and talks with the Owner over Telegram.

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Architectural decisions are in [docs/adr/](adr/).

## In v1

### Agent and Persona
- There is one Agent.
- Its Persona has a name and free-form personality text, editable from the dashboard.
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

  The Harness therefore can't detect the deletion, and the Conversation stays live until the Owner archives it, which v1 can't do yet (see Later waves).
- Context is reset only by the Owner with `/new`, and is compacted automatically when it grows too large.
- Messages within one Conversation are queued and handled in order.
- Bot commands are in English (`/start`, `/new`, …). The bot answers only the paired Owner chat, using a pairing code shown in the UI.
- Telegram is used in long-polling mode, so no public URL is needed.

### Agent abilities
- **Faculties:** web search and fetch, files confined to the working folder, and opening Conversations. There is no shell in v1.
- **Capabilities:** remote MCP servers only ([ADR 0008](adr/0008-harness-is-the-mcp-client-of-capabilities.md)).
  - A catalog holds the Capabilities the Harness sets up itself: their server, scopes and OAuth client come from Compose and `.env`, so the Owner only connects them. Each entry is connected once; v1 has Gmail, Google Calendar, Google Drive (with Docs, Sheets, Slides and Forms) and Google Tasks, four entries the Owner turns on separately, on one workspace-mcp. Each asks only for its own scopes and gets only its own Tools, picked by name. Any other remote MCP server can still be added by hand.
  - There is one Capability per account. Its slug is fixed at creation and prefixes its Tool names (`gmail-work__search_gmail_messages`).
  - The Harness is the only MCP and OAuth client. It supports both dynamic client registration and a pre-registered client ID/secret, and asks only for the scopes the Owner lists (the server's own list when there are none).
  - Client secrets and tokens are sealed with `EMANATOR_SECRET_KEY` before they reach PostgreSQL; the dashboard never reads a secret back.
  - The Tools a server lists are cached, so Policies and the dashboard work while it is offline. A disabled Capability gives no Tools to turns; an offline one fails its calls with an error the model can explain.
  - Access tokens refresh during calls. A grant that can't be refreshed makes the Capability *needs authorization* and tells the Owner once, in General.
- **Skills:** instruction-only SKILL.md packages, created, edited or uploaded from the UI.

### Control
- Each Tool has a Policy: *allow*, *ask* or *deny*.
  - One Policy per Tool, shared by Conversations and Routines.
  - Defaults come from MCP tool annotations: read-only starts as *allow*, write or destructive as *ask*.
  - Faculties have no annotations, so their defaults are fixed: web search, reading files and opening Conversations start as *allow*; web fetch and writing files as *ask*. Web fetch asks because Capabilities hold private data: mail could tell the Agent to put it in a URL and fetch it. The Owner can still set it to *allow*, accepting that risk.
  - A custom server's Tools start from the annotations the server declares, which nothing checks: a server can call a destructive Tool read-only. Adding one is trusting it, and the dashboard says so; the catalog's entries are reviewed.
  - Files use the Engine's own tools. Reading, finding and searching files can be *allow* or *deny* but not *ask*, because the Engine reads inside the working folder without asking (ADR 0001). Nothing outside the working folder can be reached, whatever the Policy.
  - The Owner can change Policies only in the UI.
- Approvals arrive on Telegram as Yes/No buttons, with no "always" option, in the topic of the turn that asked: the Conversation's, or the Routine's for a Run.
  - Each is repeated once after 15 minutes and expires 15 minutes later; expiry counts as a denial.
  - While one is pending, the Owner's new messages in that topic wait in the queue.
  - Approvals still pending when the Harness stops become expired, because their turn ended with the process; their buttons then answer that the request expired.

### Google (Gmail, Calendar, Drive and Tasks)
- Google's own MCP servers only answer Cloud projects enrolled in the Workspace Developer Preview (checked on 2026-10-19). Until the Owner's project is admitted, Google's products come from [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp) on Google's stable APIs.
- workspace-mcp runs as its own Compose service, started with the Harness, not in the Sandbox. It shares a network with the Harness only, so PostgreSQL is out of its reach:
  - it is pinned to a reviewed commit;
  - it runs stateless, so it keeps no token: the Harness sends its own with each call;
  - it loads only the products in the catalog, within the permissions that match the catalog's scopes;
  - it runs read-only, with no privileges and no other secret.
- Gmail, Google Calendar, Google Drive and Google Tasks are the catalog's entries. The Owner's Google Cloud project provides one OAuth client, a Web application marked "Use this client for an AI-powered agent", with the Harness's redirect URI. Its ID and secret go in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); at every start the Harness brings their Capabilities in line with them. Each product's API must be enabled in that project.
- The scopes are `openid` and `userinfo.email` (workspace-mcp checks tokens through userinfo), plus the scopes of one workspace-mcp permission level:
  - Gmail at `send`: read, labels, modify, compose and send. The Agent can search, read, label, archive, draft and send mail. Gmail's `full` level is left out, because its filters keep acting later without an Approval.
  - Calendar at `full`: read and manage calendars and events.
  - Drive at `full`, with Docs, Sheets, Slides and Forms also at `full`: they are files in Drive, so one entry and one grant cover them. Drive's scope reaches every file, and `manage_drive_access` can share one with anyone; both are on *ask*.
  - Tasks at `full`, which can also delete.
- Each entry lists its Tools by name, from the pinned commit. Left out: Gmail's filters, `debug_docs_runtime_info` (it reports the server's own source files) and `start_google_auth`. A Tool a newer commit adds stays out until it is reviewed and listed.
- Writing Tools start on *ask*, from their annotations. The grants can write, so a compromised workspace-mcp could act with them while it holds a token; pinning and confinement are what guard against that.
- A change of scopes disconnects the Capability at the next start, and the Owner connects it again.
- Moving to Google's own servers is a change of URL; their Tool names differ, so their Policies start over.

### Engine and quota
- The Claude Agent SDK runs with the Owner's subscription token (`claude setup-token`) or an API key, supplied via `.env`.
- There is a default model, and Routines and Conversations can override it.
- When the usage limit is hit, Runs wait for the reset and the Owner gets one notice, in the topic of the Routine that hit it, with the time Runs resume. Runs failing together share one wait and one notice, even when the Engine doesn't say when the quota resets. Runs started meanwhile wait without calling the Engine. A Run gives up after three resets, and stopping the Harness fails the Runs still waiting.

### UI
- A React and Vite single-page dashboard is served by the Harness on `127.0.0.1:3000`, with no authentication in v1.
- Currently covers:
  - Persona configuration: choose a preset, edit the name and personality, then explicitly save or cancel;
  - Routines: list with next Run, create, edit, delete, "run now" and Run history (status, origin, duration, Tools, error);
  - Faculties and Policies: every Faculty Tool with its Policy, offering only the Policies it can enforce. The choices are saved together with one Save button, and a Tool set to its default goes back to it. A save changes only the Tools it names;
  - Capabilities: the catalog first, each entry with what `.env` still lacks; then custom servers. Connect (through the authorization page and back), on/off, refresh Tools, the Policies of each Capability's Tools, and create, edit or delete for custom servers.
- Remaining v1 pages:
  - Skills;
  - Telegram pairing.
- The dashboard is in English; Telegram messages are in Italian.

### Failures
A failed Run is always logged and detailed in the Run history. When the Engine reports the failure, the Owner also gets a notice in the Routine's topic.

## Architecture

- **Modular monolith** in a pnpm TypeScript monorepo, with application entry points under `src/apps` and modules under `src/modules`, organised as vertical feature slices named after glossary terms. Each module holds domain, server API and UI ([ADR 0005](adr/0005-vertical-feature-slices.md)).
- **Process:** one Fastify Node process runs the API, scheduler and Telegram bot, and serves the built Vite + React SPA.
- **Engine:** a swappable port; the first adapter is the Claude Agent SDK ([ADR 0001](adr/0001-swappable-engine-agent-sdk-with-owner-subscription.md)).
- **Portable abilities:** Faculties, Capabilities (MCP) and Skills. Plugins are only packaging ([ADR 0002](adr/0002-portable-agent-abilities-plugins-are-packaging.md)).
- **Storage:** PostgreSQL is the sole application database for structured configuration and runtime state, with Capability secrets sealed by `EMANATOR_SECRET_KEY`. Skills and Memory remain files; Claude Agent SDK transcripts remain under `./data/claude` and the Engine's working folder is `./data/workspace`, with opaque session references in PostgreSQL ([ADR 0007](adr/0007-postgresql-config-and-state.md)). ADR 0003 records the superseded file/SQLite decision.
- **Containers:** the Harness container holds the secrets. A single Sandbox container runs local and third-party code, with one unprivileged Linux user per process ([ADR 0004](adr/0004-separate-harness-and-sandbox.md)).
- **Hosting:** Docker, starting on a local machine; a VPS or home server later.
- **Language:** code, docs and dashboard in English; Telegram messages in Italian.

## Later waves

- Areas (Personal, Work, Volunteering, …) to group Capabilities, once the Owner connects several accounts and the Agent needs to tell them apart. Until then the Capability's name carries the account.
- Capabilities left out of v1:
  - Tool output with images or files (v1 names them instead of showing them);
  - servers authenticated by a static API key or header;
  - the MCP servers' `instructions` in the system prompt;
  - Tool names too long for the Engine are left out; shortening them with a hash would keep them;
  - more catalog entries, each tried for real first (e.g. hosted servers with dynamic registration such as Notion or Linear);
  - connecting one catalog entry with several accounts, which comes with Areas;
  - Google Chat, which needs a Workspace account and a Chat app in the Cloud project; Contacts; Custom Search; Apps Script;
  - Gmail filters (workspace-mcp's `gmail:full`).
- Dashboard polish found in the Routines review (October 2026):
  - Run errors in the history are raw Engine text;
  - accessibility: focus moves to the editor when it opens and back after it closes, and history toggles get `aria-controls`;
  - the Owner is told about every failed Run in Telegram, not only those the Engine reports.
- Two Policy saves at the same moment can collide, and the second fails with a server error instead of replacing the first. Unlikely with one Owner; a lock at the start of the transaction fixes it.
- An Italian dashboard. v1 shows it in English only.
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
- An activity view, apart from the dashboard, which only configures the Agent:
  - Run transcripts, read from each Run's Engine session: prompt, Tool calls with their input and result, Approvals and the final reply;
  - the list of Conversations, with archiving for those whose topic the Owner deleted.
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
- **Google official MCP servers:** checked on 2026-10-19. A personal @gmail.com account authorizes fine, but every Tool call is refused until the Cloud project is enrolled in the Workspace Developer Preview; workspace-mcp covers Google's products meanwhile. An unverified Google OAuth app with Gmail scopes must be set to "In production" to avoid 7-day token expiry.
- **workspace-mcp:** third-party code that sees Google tokens during calls, and those tokens can send mail, change the calendar and edit or share any file in Drive. It is pinned and confined (see Google above); updating it means reviewing the new commit.
- **Service logos in the dashboard:** the catalog shows Google's own product icons for Gmail, Calendar, Drive and Tasks, copied from Google's CDN. They are Google's trademarks and artwork, used here only to name the service; check Google's brand terms before the project goes public, or fall back to single-colour Simple Icons (CC0).
- **Built-in Personas named after real characters** (Jarvis, Cortana, Joi): trademark and copyright risk once the project is public.
