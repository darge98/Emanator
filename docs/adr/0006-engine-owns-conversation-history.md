# The Engine owns conversation history; the Harness keeps only an opaque reference

For each Conversation (and each Run), the Harness stores only an opaque, Engine-specific session reference, for example the Agent SDK session id. The Engine owns the transcript and its compaction; with the Claude Agent SDK, transcripts live under `CLAUDE_CONFIG_DIR` on the data volume. Each turn is a separate Engine call that resumes the session from that reference and then ends, so no process stays alive between turns.

## Considered Options

- **Harness-owned transcript, replayed to the Engine on every turn.** Conversations would survive an Engine swap, but we would have to rebuild the storage format and the compaction the SDK already provides.
- **One long-lived Engine session per active Conversation.** Replies would be faster and message injection would come almost for free, but every open Conversation would hold a process in memory. It may come back as a second mode of the Engine port when injection is built.

## Consequences

- Swapping Engines resets every Conversation, just as `/new` does. The Memory (later wave) is what carries knowledge across that boundary.
- Each turn pays the Engine's start-up cost, about a second.
