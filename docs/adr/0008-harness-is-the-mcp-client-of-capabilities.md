# The Harness is the only MCP and OAuth client of Capabilities

Each Capability is a remote MCP server for one account. The Harness connects to it, authorizes it through the Owner's browser and keeps its tokens, sealed with `EMANATOR_SECRET_KEY`. It lists the server's Tools into a cache and relays them to each turn as its own Tools, through the in-process tool server that already carries the Faculties. The Engine sees a Capability's Tools by the name `<slug>__<tool>`, with their JSON Schema unchanged. It never sees a token or the server's address.

For Gmail and Calendar, the server is [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp), run as a separate Compose service. Google's own MCP servers answer only projects enrolled in the Workspace Developer Preview. workspace-mcp serves the same data through Google's stable APIs.

Capabilities the Harness can set up itself form a catalog: their server, scopes and OAuth client come from Compose and `.env`, so the Owner only connects them. Gmail and Google Calendar are its first entries: two Capabilities on one workspace-mcp, each with its own scopes and grant, and each given only its product's Tools. Any other remote MCP server can still be added by hand.

## Considered Options

- **Hand the server to the Engine** (`{ type: 'http', url, headers }` in the SDK options). It needs less code, but it has three costs:
  - the Owner's tokens would reach the Engine's process, which today sees only the Claude credential;
  - another Engine would need its own MCP support (ADR 0002);
  - Policies, Approvals and the Run history would need a second path for Tool names.
- **Wait for Google's preview**, or **write our own Gmail and Calendar server**. Waiting blocks Google indefinitely. Writing our own server repeats work that workspace-mcp already does well.
- **workspace-mcp in the Sandbox** (the earlier plan B). The Sandbox brings the shell and local servers with it, and those stay in a later wave. A separate container gives the same isolation now.

## Consequences

- Capability Tools follow the Faculty rules:
  - they are filtered by Policy before each turn;
  - they are checked by the same `PermissionDecider`;
  - their default Policy comes from MCP annotations: read-only means *allow*, anything else means *ask*.
- **Disabled and offline Capabilities.** A disabled Capability gives no Tools to turns. One whose server is offline still offers its cached Tools, and a call to it returns an error that the model can explain.
- **OAuth.** The Harness asks for the scopes the Owner chose: left alone, the SDK would ask for every scope a server lists, which for Google includes full mailbox access.
  - Google's authorization URL gets `access_type=offline` and `prompt=consent`, because Google issues refresh tokens only on request.
  - A grant that can't be refreshed makes the Capability `needs-auth` and tells the Owner once, in General.
- **Custom servers are trusted by whoever adds them.** Their default Policies come from annotations the server declares about its own Tools, which nothing checks. The catalog's entries are reviewed; a custom server is the Owner's call, and the dashboard says so.
- **Web fetch asks first.** Capabilities hold private data that an injected instruction could carry out in a URL, so `web_fetch` now defaults to *ask*.
- **Tool names.** A name the Engine can't carry is left out with a warning: one with characters outside `[A-Za-z0-9_-]`, or one longer than 113 characters with its slug. The Claude Agent SDK drops longer names silently.
- **workspace-mcp is third-party code that sees Google tokens.**
  - It is pinned to a reviewed commit and runs stateless, keeping no token.
  - It loads only the products in the catalog, within its permissions (`gmail:send`, and `full` for Calendar, Drive, Docs, Sheets, Slides, Forms and Tasks). Each catalog entry takes its Tools by name, and those that write start on *ask*.
  - It has no privileges and no other secret, and shares a network with the Harness only, away from PostgreSQL.
  - Its grants were read-only at first. Since 2026-10-19 they can send mail, manage the calendar and tasks, and edit or share any file in Drive, so a compromised workspace-mcp could write with the tokens it is given; Gmail filters stay out.
  - Updating it is a deliberate change.
- **The catalog follows `.env`.** At every start and connection, a catalog Capability takes its settings from `.env`. A new client or address drops its connection, because its tokens were granted for the old ones. The dashboard can only connect it, turn it on or off, or disconnect it.
- **Moving to Google's servers.** When Google's own servers become usable, moving is a change of URL. The Tool names differ, so the Owner sets those Policies again.
