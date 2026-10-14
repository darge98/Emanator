<div align="center">

<img src="docs/assets/emanator.svg" width="88" height="88" alt="" />

# Emanator

Project the assistant you want.

</div>

An always-on, proactive personal AI agent that lives on Telegram, built on the Claude Agent SDK.

In *Blade Runner 2049*, the emanator is the device that projects Joi. This project does the same: it gives a body to the personality you choose, and lets it act for you on a schedule as well as when you talk to it. It serves one person only, and you run it yourself.

> **Status: early.** Today you can talk to the agent on Telegram. Routines, Capabilities, Personas and the web UI are next; see the [roadmap](#roadmap). The vocabulary used everywhere in the code and docs is defined in [`CONTEXT.md`](CONTEXT.md).

## What works today

- 💬 **Conversation on Telegram.** Write in the General topic or open a dedicated one with `/topic`. Each Conversation keeps its own context until you reset it with `/new`. While the agent works you see a live status; replies arrive as rich Markdown.
- 🔐 **Talks only to you.** A one-time pairing code links your Telegram account; everyone else is ignored.
- 🧠 **Your Claude, your quota.** It runs on your Claude Pro/Max subscription or an Anthropic API key. `/status` shows how much of the five-hour and seven-day windows you have used.
- 🧩 **Swappable parts.** The model engine and the channel sit behind interfaces. The agent is isolated from your own Claude Code setup and gets no built-in tools you didn't choose.

## Roadmap

The v1 scope is in [`docs/v1-scope.md`](docs/v1-scope.md). In short:

- ☀️ **Routines** started by schedules, such as a morning briefing or a heartbeat that decides on its own whether you need to know something.
- 🔌 **Capabilities**: any remote MCP server with OAuth (Gmail, Calendar, …), one per account, grouped by Area (Personal, Work, …).
- 🛠️ **Faculties and Skills**: web, files and know-how packages, in the same formats as Claude Code.
- ✋ **Approvals**: every Tool has a Policy (*allow*, *ask*, *deny*); *ask* becomes Yes/No buttons on Telegram.
- 🎭 **Personas**: built-in presets inspired by Joi, JARVIS and Cortana, or your own.
- 🎛️ **A local web UI** to configure all of the above.

Later waves include webhooks, Memory, Reminders created by the agent, a sandbox for local code, and a usage dashboard. Ideas from the first prototype are kept in [`docs/legacy-ideas.md`](docs/legacy-ideas.md).

## Quick start

You need Docker with Compose, a Telegram account, and a Claude Pro/Max subscription or an Anthropic API key.

1. **Create the bot.** In [@BotFather](https://t.me/BotFather), send `/newbot` and keep the token. Then tap **Open** to launch BotFather's Mini App, go to *My bots → your bot → Bot Settings → Threads Settings*, turn on **Threaded Mode**, and disallow users from creating threads.
2. **Add your credentials.**

   ```sh
   cp .env.example .env && chmod 600 .env
   claude setup-token
   ```

   Put the printed token in `CLAUDE_CODE_OAUTH_TOKEN` (or set `ANTHROPIC_API_KEY` instead, never both) and the bot token in `TELEGRAM_BOT_TOKEN`.
3. **Start the Harness.**

   ```sh
   docker compose up -d --build harness
   ```

4. **Pair with the bot.** The logs show a one-time code:

   ```sh
   docker compose logs harness
   ```

   Send the bot the message it prints (`/start <code>`). From then on it answers only you.

Commands: `/new` resets the context of the current Conversation, `/topic <name>` opens a dedicated topic, `/status` shows quota and model, and `/help` lists them.

You can delete a topic from the Telegram app as usual. It only disappears on your side, though: Telegram doesn't tell the bot, so anything the bot sends there later shows up in General.

> **About subscriptions.** Using a Pro/Max subscription token with the Agent SDK is a grey area in Anthropic's terms ([ADR 0001](docs/adr/0001-swappable-engine-agent-sdk-with-owner-subscription.md)). Emanator never logs you in: you bring your own credentials, and an API key always works.

## Development

You need Node 24 and pnpm.

```sh
pnpm install
pnpm test        # unit tests
pnpm typecheck
pnpm check       # Biome lint and format check
```

To check the Engine end to end against your real account (this spends a little quota):

```sh
docker compose run --rm engine-smoke
```

Don't run two instances against the same bot: they would compete for the same updates.

## Architecture

A modular monolith in a pnpm workspace. Each feature is a package named after a glossary term, holding its domain, its server side and, later, its UI ([ADR 0005](docs/adr/0005-vertical-feature-slices.md)).

| Package | What it does |
|---|---|
| [`packages/engine`](packages/engine) | The Engine port and its Claude Agent SDK adapter: one process per turn, sessions resumed by reference. |
| [`packages/channels`](packages/channels) | The Channel port and the Telegram adapter (grammY, long polling). |
| [`packages/conversations`](packages/conversations) | Conversations: one per thread, with a queue and commands. |
| [`packages/shared`](packages/shared) | SQLite (`node:sqlite`), per-feature migrations, logging. |
| [`apps/server`](apps/server) | The composition root that runs the Harness. |

Runtime data lives in `./data`: the state database and the Claude sessions.

## Learn more

- [`CONTEXT.md`](CONTEXT.md): the domain language.
- [`docs/v1-scope.md`](docs/v1-scope.md): what v1 contains and what comes later.
- [`docs/adr/`](docs/adr/): why the project is built the way it is.
- [`docs/legacy-ideas.md`](docs/legacy-ideas.md): ideas carried over from the first prototype.

## License

[MIT](LICENSE)
