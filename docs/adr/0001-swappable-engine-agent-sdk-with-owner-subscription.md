# Swappable Engine; the first one runs on the Agent SDK with the Owner's subscription credentials

The Engine is an interface (a port), and the rest of the Harness does not know which SDK or provider sits behind it. The first implementation uses the Claude Agent SDK (TypeScript). It authenticates with a token the Owner generates from their own Claude Pro/Max subscription using `claude setup-token`, or with an API key. The Harness never implements or offers a login flow to Anthropic: whoever installs it brings their own credentials.

## Considered Options

- **Headless CLI (`claude -p`)**: the most defensible route under the Claude Code legal page ("does not prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription"). It is less ergonomic, though: Approvals and Harness Tools would have to go through an MCP server. It stays the fallback if the rules on the SDK tighten.
- **API key only**: fully compliant, but the Owner has no API key today and wants to use the subscription they already pay for.

## Consequences

- Using the SDK with a subscription token is a grey area (checked 2026-10-14). The docs tell "products or services" built on the Agent SDK to use API keys, and forbid third-party developers from offering claude.ai login. A support article updated 2026-10-07 says the SDK and `claude -p` can be used within your plan's limits. Anthropic may enforce without notice.
- The subscription quota is shared with the Owner's interactive Claude Code use.
- claude.ai connectors are not available with the token, so the Harness must connect external services itself (MCP OAuth).
- The Engine needs a long-running process, because the SDK spawns the Claude Code CLI as a subprocess. Serverless hosting is ruled out.
