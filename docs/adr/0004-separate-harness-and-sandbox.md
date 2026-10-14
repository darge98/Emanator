# Brain and hands in separate containers: Harness and Sandbox

Secrets live only in the Harness container: the Engine token, the Capabilities' OAuth tokens and the configuration. Code the Agent runs, or that comes from third parties (the shell Faculty, local MCP servers, Skill scripts), executes in the Sandbox, which cannot see those secrets. Each local MCP server receives only its own secrets.

The reason is third-party code. An MCP server launched with `npx` or `uvx` runs with the same access as the process that started it, so a compromised package in the Harness container could read every token. Likewise, a prompt injection that reaches the shell could read them and exfiltrate them.

The shell is a Faculty implemented by the Harness, which runs commands in the Sandbox. It is not the Agent SDK's native Bash tool, which would run inside the Harness container (see ADR 0002).

There is one Sandbox per installation, not one per integration, so adding a local MCP server stays a UI operation. Inside the Sandbox, each process runs as its own unprivileged Linux user that sees only its own secrets and its own folder:

- one user per local MCP server;
- one more user for the shell, which sees only the working folder.

Local MCP servers start on demand. Performance is not a concern: processes cost the same in one container as in many, and the real bottleneck is model calls.

## Consequences

- v1 runs no local code: no shell, no local MCP servers, and only instruction-only Skills. The Sandbox arrives in the wave that introduces them, or earlier if Google's official MCP servers don't accept the Owner's account and the fallback (`workspace-mcp`, run locally) is needed.
- This split does not prevent data exfiltration through web fetch or remote Tools; Policies handle that.

## Considered Options

- **A single hardened container** (separate Linux users per process, minimal environment): more convenient, but one misconfiguration or privilege escalation defeats the protection.
- **One sidecar container per MCP server**: maximum isolation, but every integration means editing docker-compose by hand, outside the UI.
