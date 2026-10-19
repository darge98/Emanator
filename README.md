<div align="center">

<img src="docs/assets/emanator.svg" width="88" height="88" alt="" />

# Emanator

Project the assistant you want.

</div>

An always-on, proactive personal AI agent that lives on Telegram, built on the Claude Agent SDK.

In *Blade Runner 2049*, the emanator is the device that projects Joi. This project does the same: it gives a body to the personality you choose, and lets it act for you on a schedule as well as when you talk to it. It serves one person only, and you run it yourself.

> **Status: early.** The local dashboard lets you configure the Agent's Persona and its Routines. Telegram conversations are also available, and Capabilities connect it to your accounts through MCP servers. See the [v1 scope](docs/v1-scope.md). The vocabulary used throughout the code and docs is defined in [`CONTEXT.md`](CONTEXT.md).

## What works today

- 💬 **Conversation on Telegram.** Write in the General topic or open a dedicated one with `/topic`. Each Conversation keeps its own context until you reset it with `/new`. While the agent works you see a live status; replies arrive as rich Markdown.
- 🔐 **Talks only to you.** A one-time pairing code links your Telegram account; everyone else is ignored.
- ☀️ **Routines.** Give the agent goals to pursue on a schedule (days of the week, day of the month, a date, an interval or a cron expression), such as a morning briefing or a heartbeat that writes only when there is something worth saying. Each Routine writes in a Telegram topic of its own, where you can reply with its context. Manage them, run them now and see their history from the dashboard; changes apply without a restart.
- 🎭 **Shape its Persona.** Set the Agent's name and personality from the dashboard at `http://127.0.0.1:3000`. Presets copy their values into editable fields; saving takes effect from the next turn.
- 🔌 **Capabilities.** Connect remote MCP servers, one per account, from the dashboard: the Harness signs in with OAuth, keeps the tokens encrypted, and gives the agent each server's Tools under the Policies you set. Gmail and Calendar work through [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp), read-only.
- 🧠 **Your Claude, your quota.** It runs on your Claude Pro/Max subscription or an Anthropic API key.
- 🧩 **Swappable parts.** The model engine and the channel sit behind interfaces. The agent is isolated from your own Claude Code setup and gets no built-in tools you didn't choose.

## Roadmap

The v1 scope is in [`docs/v1-scope.md`](docs/v1-scope.md). In short:

- 🛠️ **Faculties and Skills**: web, files and know-how packages, in the same formats as Claude Code.
- ✋ **Approvals**: every Tool has a Policy (*allow*, *ask*, *deny*); *ask* becomes Yes/No buttons on Telegram.
- 🧩 **Agent configuration**: Skills, Run transcripts and the remaining dashboard pages.

Later waves include Areas to group Capabilities, webhooks, Memory, Reminders created by the agent, a sandbox for local code, and a usage dashboard. Ideas from the first prototype are kept in [`docs/legacy-ideas.md`](docs/legacy-ideas.md).

## Quick start

You need Docker with Compose, a Telegram account, and a Claude Pro/Max subscription token or an Anthropic API key. Compose runs PostgreSQL 18 alongside the Harness.

1. **Create the bot.** In [@BotFather](https://t.me/BotFather), send `/newbot` and keep the token. Then tap **Open** to launch BotFather's Mini App, go to *My bots → your bot → Bot Settings → Threads Settings*, turn on **Threaded Mode**, and disallow users from creating threads.
2. **Add your credentials.**

   ```sh
   cp .env.example .env && chmod 600 .env
   claude setup-token
   ```

   Put the printed token in `CLAUDE_CODE_OAUTH_TOKEN` (or set `ANTHROPIC_API_KEY` instead, never both) and the bot token in `TELEGRAM_BOT_TOKEN`. Set `EMANATOR_SECRET_KEY` to the output of `openssl rand -base64 32`: it encrypts the Capabilities' tokens, and changing it later disconnects them all.
3. **Start the Harness and dashboard.**

   ```sh
   docker compose up -d --build harness
   ```

   Open `http://127.0.0.1:3000` to edit the Persona. The dashboard is local and has no authentication.

4. **Pair with the bot.** The logs show a one-time code:

   ```sh
   docker compose logs harness
   ```

   Send the bot the message it prints (`/start <code>`). From then on it answers only you.

### Connecting Gmail and Calendar

Google's own MCP servers only answer projects in its Workspace Developer Preview, so Emanator uses [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp) on Google's regular APIs ([ADR 0008](docs/adr/0008-harness-is-the-mcp-client-of-capabilities.md)).

1. In a Google Cloud project, enable the Gmail and Google Calendar APIs. In Google Auth Platform:
   - add yourself as a test user;
   - add the scopes `gmail.readonly` and `calendar.readonly`;
   - create an OAuth client of type *Web application*, tick *Use this client for an AI-powered agent*, and add the redirect URI `http://127.0.0.1:3000/api/capabilities/oauth/callback`.
2. In `.env`, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the client's ID and secret, and `WORKSPACE_MCP_JWT_KEY` to the output of `openssl rand -base64 32`. Then start everything again, workspace-mcp included:

   ```sh
   docker compose up -d --build
   ```

3. In the dashboard, under **Capabilities**, press **+** next to Gmail, Google Calendar or both, and agree in Google's page each time. The address and scopes are already set up, and each one asks only for its own access.

With `pnpm dev` instead of Compose, also set `WORKSPACE_MCP_URL=http://127.0.0.1:8001` in `.env`.

Any other remote MCP server can be added by hand with **Add a custom MCP server**.

Commands: `/new` resets the context of the current Conversation, `/topic <name>` opens a dedicated topic, `/status` shows quota and model, and `/help` lists them.

You can delete a topic from the Telegram app as usual. It only disappears on your side, though: Telegram doesn't tell the bot, so anything the bot sends there later shows up in General.

> **About subscriptions.** Using a Pro/Max subscription token with the Agent SDK is a grey area in Anthropic's terms ([ADR 0001](docs/adr/0001-swappable-engine-agent-sdk-with-owner-subscription.md)). Emanator never logs you in: you bring your own credentials, and an API key always works.

## Development

You need Docker Compose, Node 24 and pnpm. Set `DATABASE_URL` in `.env` for native development; Compose configures the Harness connection from `POSTGRES_PASSWORD` (the development default is local-only).

```sh
docker compose up -d postgres
pnpm install
pnpm build
pnpm dev
```

The native Harness loads `.env` and serves the dashboard at `http://127.0.0.1:3000`. It requires a Telegram bot token even when you are only working on the dashboard.

PostgreSQL is the Harness's only application database for configuration and runtime state. Claude Agent SDK transcripts and workspace files stay under `./data/claude`; PostgreSQL holds the opaque session references.

The build and verification scripts are:

```sh
pnpm build
pnpm typecheck
pnpm check       # Biome lint and format check
pnpm test
```

Database tests create and remove isolated schemas in the PostgreSQL database configured by `TEST_DATABASE_URL`. Without it, these tests are skipped and the remaining unit tests still run. With the local development database:

```sh
TEST_DATABASE_URL=postgresql://emanator:emanator@127.0.0.1:5432/emanator pnpm test
```

For frontend development, run `pnpm dev:web` in another terminal. Vite reloads source changes and proxies requests to the running Harness.

To check the Engine against your real account, run `docker compose run --rm engine-smoke`. This spends real quota; automated tests use a simulated Engine.

Don't run two instances against the same bot: they would compete for the same updates.

## Architecture

A modular monolith in a pnpm workspace. Application entry points live under `src/apps`; feature modules live under `src/modules`. Each module is a workspace package named after a glossary term, holding its domain, its server side and its UI ([ADR 0005](docs/adr/0005-vertical-feature-slices.md)).

| App / module | What it does |
|---|---|
| [`src/modules/engine`](src/modules/engine) | The Engine port and its Claude Agent SDK adapter: one process per turn, sessions resumed by reference. |
| [`src/modules/channels`](src/modules/channels) | The Channel port and the Telegram adapter (grammY, long polling). |
| [`src/modules/conversations`](src/modules/conversations) | Conversations: one per thread, with a queue and commands. |
| [`src/modules/policies`](src/modules/policies) | Policies for every Tool, and Approvals on Telegram. |
| [`src/modules/faculties`](src/modules/faculties) | The Agent's innate Tools: web, files, opening Conversations. |
| [`src/modules/capabilities`](src/modules/capabilities) | Remote MCP servers per account: OAuth, encrypted tokens, Tools relayed to turns. |
| [`src/modules/routines`](src/modules/routines) | Routines, their schedules and Runs. |
| [`src/modules/personas`](src/modules/personas) | Persona storage, preset catalog, prompt instructions, configuration API and editor UI. |
| [`src/modules/shared`](src/modules/shared) | PostgreSQL connection and migrations, logging. |
| [`src/apps/server`](src/apps/server) | The composition root that runs the Harness. |
| [`src/apps/web`](src/apps/web) | Vite + React dashboard served by the Harness. |

PostgreSQL is the sole application database for structured configuration and runtime state, stored on its durable named volume. The Claude Agent SDK keeps transcripts under `./data/claude`, and the Engine's working folder is `./data/workspace`. Skills and Memory remain file based.

## Learn more

- [`CONTEXT.md`](CONTEXT.md): the domain language.
- [`docs/v1-scope.md`](docs/v1-scope.md): what v1 contains and what comes later.
- [`docs/adr/`](docs/adr/): why the project is built the way it is.
- [`docs/legacy-ideas.md`](docs/legacy-ideas.md): ideas carried over from the first prototype.

## License

[MIT](LICENSE)
