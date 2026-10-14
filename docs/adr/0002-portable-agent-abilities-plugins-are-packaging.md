# Agent abilities are portable primitives; Plugins are just packaging

The Harness model knows three kinds of ability, all independent of the Engine:

- **Faculties**: innate abilities such as web, files, shell, Reminders and Conversations. The Harness defines them and each Engine implements them.
- **Capabilities**: MCP servers, an open standard.
- **Skills**: packages in the open SKILL.md format.

Plugins in the Claude Code format are installed from marketplaces, but they are broken down into Capabilities and Skills. Hooks, sub-agents and slash commands are ignored, or at most flagged in the UI.

The Agent SDK's native tools (Bash, WebSearch, Read, …) also go through Faculties. The Harness exposes an explicit list governed by Policies instead of inheriting the SDK's default tool set. That way, if the Engine is ever swapped, the Agent can still do the same things, and it never has a tool the Owner didn't choose.

## Considered Options

- **Pass whole Plugins, hooks included, to the Claude Engine.** It gives maximum compatibility today, but different Engines would end up behaving differently with the same configuration.
- **Use the SDK's native tools directly, with no Faculty layer.** It costs less, but the Agent's abilities would silently depend on the Engine, and the Agent would also get coding-oriented tools (sub-agents, notebooks) that a personal assistant doesn't need.
