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

## Verification (2026-10-14)

Run with Agent SDK 0.3.296 and Claude Code 2.1.296 on a Pro plan, using `packages/engine/scripts/smoke.ts` in a clean Linux container that had only the `setup-token` token and no host login. Every check passed:

- **Authentication.** Turns run on the subscription token alone; the SDK reports `apiKeySource: "none"`, as it does for OAuth.
- **Isolation.** With `settingSources: []` and `tools: []`, the model sees no built-in tools, only the Harness's own.
- **Harness Tools and Approvals.**
  - In-process Tools work.
  - `canUseTool` waits for an asynchronous decision; a 3-second simulated Approval held the turn open.
  - A denial reaches the model as an error result, the turn completes normally, and the denial is listed in `permission_denials`.
- **Sessions and models.** A session resumed under the same id with a different model per turn (Haiku 5.5, then Sonnet 5.5) and kept its context. Opus 5.5 is available on Pro.
- **Quota signals.**
  - A `rate_limit_event` arrives on every turn. Its status and five-hour window reset time (epoch seconds) are enough for the "wait for reset and notify" rule.
  - Utilization per window (five hours, seven days) appears only in an undocumented `unifiedWindows` field, as 0–1 fractions. The documented `utilization` field never arrived. The Engine reads `unifiedWindows` best-effort: malformed entries are skipped and a missing field only drops the percentages. The smoke script warns if an SDK upgrade removes it.
- **Plan type.** The experimental usage API returns no plan type and no rate-limit windows for a `setup-token` token, which probably lacks the profile scope. The Harness therefore cannot show "Pro" from the token alone.
- **Cost and latency.** Each turn reports an estimated cost in USD, which on a subscription is not a bill. A turn takes 1.5–6 s end to end, start-up included.
