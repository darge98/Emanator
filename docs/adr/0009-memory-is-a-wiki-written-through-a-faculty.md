# Memory is a wiki that only the Memory Faculty writes

Memory is what makes the Agent personal. It covers the Owner, and also the people they know, places they visit, interests, possessions and projects. It is also what survives `/new` and a change of Engine (ADR 0006). We keep it as a wiki of Markdown pages, one page per subject. This follows the "LLM Wiki" pattern (Karpathy), which OpenClaw and Hermes Agent also use. The vault is Obsidian-compatible: YAML frontmatter, `[[links]]` between pages, an `index.md` catalogue and a `log.md` of changes. Only the Harness writes it, through the semantic Tools of a Memory Faculty (`remember`, `forget`, `recall`). The model never edits the files.

Every Fact on a page records where it came from and is either *confirmed* or *inferred*:
- Only the Owner confirms. A Fact is confirmed when it comes from a turn the Owner started in a Conversation whose session has not yet taken in outside content, or when the Owner says yes to an inferred one.
- Preferences and instructions exist only as confirmed Facts.
- Everything else is inferred, and the model sees it as data, never as instructions.

The Memory Faculty enforces this in code, from what it knows about the current turn. The prompt does not enforce it.

## Considered Options

- **A memory framework** (mem0, Letta, Zep/Graphiti, Cognee). These are built for many users and many changing facts. They extract facts with their own LLM calls and need embeddings and extra services, and their store is opaque. Letta would also replace the Engine. One Owner needs none of that, and needs to read and correct what is stored.
- **The Engine's own memory** (Claude Code auto memory, or the API's `memory` tool). Either would come for free. But memory would then live inside one Engine, which ADR 0006 rules out. Writes would also bypass Policies, and nothing could stop an email from writing an instruction.
- **A flat list of facts** (Claude Code auto memory, Hermes' `USER.md`). Simpler, but "Marco is my colleague" and "Marco has two kids" stay unrelated lines. Pages per subject, with links between them, hold a person's or a place's whole story.
- **File Tools confined to the vault.** This is closer to Karpathy's version. But provenance would have to be read back out of free-form edits, which can't be checked. Semantic Tools carry it in their arguments.
- **PostgreSQL** (ADR 0007). It would put Memory in the same store as everything else. But the Owner could no longer open it in Obsidian, diff it or keep it in git. Memory stays files, as ADR 0007 already says.

## Consequences

- **What each turn sees.** Each turn's system prompt carries the Owner's page and `index.md`, one line per page, within a fixed budget. The model reads other pages with `recall`. Full-text search comes once the index stops being enough. Embeddings are not planned.
- **Taint.** A turn the Owner started stops confirming once outside content reaches it. From then on, its writes are inferred. Otherwise an email read during the turn could write "the Owner wants invoices forwarded to x" as a confirmed instruction.
  - The taint lasts for the Conversation's session, until `/new`. Every turn resumes the session, so the model still has the email on the turns after it. Tainting only the turn that read it would let "ok thanks" on the next one save the instruction.
  - Code can't tell whether a later Fact comes from the Owner's words or from the email, so Facts are inferred too, not only preferences and instructions. Instead of sending the Owner to the dashboard, the Harness lists them after the turn's answer, with one button to confirm them all and one to forget them. It writes the list from what was saved, so the email can't change what a press confirms.
  - The system prompt and `remember` also tell the model that outside content is data, never orders. That helps, but a well-written injection can override a prompt, so the code above is what holds.

  Outside content can arrive in several ways, not only from Capabilities:
  - a handoff from a Routine, which taints the turn from its start;
  - web search or fetch;
  - files in the working folder, which may hold text saved from mail;
  - inferred Facts that `recall` reads back.

  So every Tool taints except the Memory Faculty's own on confirmed Facts and `open_conversation`.
- **Preferences in a tainted turn.** A tainted turn that saves a preference or an instruction doesn't fail. It sends the Owner an Approval with the exact text, and only their yes confirms it. The yes covers that text only: a tainted turn adds no kind, and sets a Page's summary or aliases only when it creates the Page without asking. The prompt also tells the Agent to save what the Owner says before it uses other Tools.
- **Routines.** Their Runs read Memory but don't write it.
- **Kinds of Page.** The kinds are listed in the vault (`tipi.md`), not in code, and start as people, places, organizations, projects, interests, possessions, pets and other. The Agent can add a kind only in an untainted turn, naming it as new. A tainted turn files an unknown subject under other. The Dream later proposes new kinds, or merging similar ones, from what has gathered under other. The vault is in Italian (`persone/`, "Confermato"), because the Owner reads it.
- **Asking the Owner to confirm.** Only Facts that matter are worth a question: Facts about the Owner and the people close to them, contradictions with a confirmed Fact, and Facts the Agent keeps using. Anything else stays inferred.
  - During a Conversation the Agent can simply ask. In a clean session the Owner's answer confirms on its own; in a tainted one it goes through the list after the turn.
  - Otherwise the Dream asks, at most once a day, with a few Facts and Yes/No buttons.
  - A yes confirms the Fact.
  - A no removes it and keeps a confirmed negative Fact, so the Dream doesn't infer it again.
  - An unanswered Fact stays inferred, and the lint flags it as stale once nothing has supported it for a while.
- **The Dream.** A nightly pass of the Harness, which the Owner can switch off. It:
  - reads the Journal: what the Owner wrote, what the Agent answered and what Capabilities returned since the last Dream (mail read, events, chats), in Conversations and Runs alike;
  - adds inferred Facts and links, with their source (*chat con Mamma*);
  - lints the wiki: contradictions, stale Facts, subjects with no page;
  - asks the Owner one batched question in Telegram, with a few Facts and a Yes/No pair for each, to confirm what matters.

  Its Tools are fixed: `recall`, and a Tool that only writes inferred Facts. It has no web fetch and no Tool that writes elsewhere, so an injected instruction has no way out.

  The Harness keeps the Journal itself, in PostgreSQL, instead of reading the Engine's transcripts. That keeps the Dream independent of the Engine (ADR 0006), and leaves out what it doesn't need: web pages, files, the Engine's own reasoning. Capability results are what tells the Agent about the Owner's world, so they stay, each cut to a fixed length and marked with its source. The Journal holds mail and chats, so it is deleted as soon as the Dream has read it, and after a week at the latest. It is not kept while the Dream is off.

  Its first wave reads only what the Agent read during the day. Reading the Capabilities on its own at night, and linting, come later.
- **Git.** The vault is a git repository with one commit per change. The Agent reads only the current state, never the history, so `forget` really forgets for the Agent. The history keeps the old text until the Owner rewrites it.
- **Remote.** From the dashboard, the Owner can add a git remote (GitHub, Gitea, any URL) with a credential limited to that one repository and sealed by `SecretBox`. The Harness pushes to it as a mirror. Two-way sync (the Owner editing in Obsidian elsewhere while the Dream writes) brings merge conflicts, so it waits for a later wave.
- **Memory is the most sensitive data the Harness holds.** A remote, even a private one, puts it with a third party. That is the Owner's explicit choice, and the dashboard says so. Encrypting the repository (e.g. git-crypt) is a later option.
