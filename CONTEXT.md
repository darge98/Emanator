# Emanator

An open-source, self-hosted harness that keeps a personal AI agent always on. The agent acts proactively in response to events and talks with its owner through communication channels.

Code and docs use the English terms below. The UI is translated, so each term also gives its Italian label.

## Language

### Platform

**Harness** (it: *Harness*):
The self-hosted platform that hosts the Agent and connects it to Events, Capabilities and Channels. Each installation serves exactly one Owner.
_Avoid_: framework, server, bot

**Time zone** (it: *Fuso orario*):
The zone in which the Agent reads and tells the Owner's wall-clock times, such as "at 6 pm" or "every day at 8". The Owner chooses it; changing it moves recurring times with the Owner, while moments already set stay the same moment.
_Avoid_: locale, region

**Owner** (it: *Utente*):
The single person an Harness installation serves. They configure the Agent and receive its messages.
Owner is a role, not a personal name or a form of address.
_Avoid_: user, account

**Agent** (it: *Agente*):
The configured assistant: Persona, Faculties, Capabilities, Skills, Channels and Routines. For now there is exactly one Agent per Harness.
_Avoid_: bot, assistant, AI

**Persona** (it: *Personalità*):
The Agent's character: a name and free-form personality text that describe its tone, style and behavioural rules. A preset can provide initial values, which the Owner can edit; the saved Persona contains no link to the preset.
_Avoid_: character, system prompt

**Preset** (it: *Preset*):
A built-in starting point for a Persona. Applying one copies its name and personality into the editable Persona fields; later changes to that Persona are independent of the preset.
_Avoid_: template, profile

**Area** (it: *Ambito*):
A part of the Owner's life, such as Personal, Work, Volunteering or Hobby. Capabilities will belong to Areas, so the Agent knows which part of the Owner's life an account relates to (a later wave).
_Avoid_: label, tag, category, profile, context

**Memory** (it: *Memoria*):
The Agent's persistent wiki about the Owner and their world: pages about the Owner, the people they know, places, interests, possessions and projects, linked to one another. The Agent curates it and the Owner can read and correct it. It survives Conversation resets and a change of Engine.
_Avoid_: knowledge base, profile, context, second brain

**Page** (it: *Pagina*):
One subject in Memory (the Owner, a person, a place, an interest, a possession…) with the Facts known about it.
_Avoid_: note, entity, document, file

**Fact** (it: *Fatto*):
A single piece of knowledge on a Page, with where it came from. It is either *confirmed* (by the Owner) or *inferred* (by the Agent, from Conversations or Capabilities). Preferences and instructions can only be confirmed Facts.
_Avoid_: memory, note, claim

**Dream** (it: *Sogno*):
The Harness's nightly pass over Memory. It infers new Facts from the day, links and tidies Pages, finds contradictions, and asks the Owner to confirm what matters.
_Avoid_: consolidation, sync, digest

**Journal** (it: *Diario*):
What the Harness keeps of the days for the Dream: the Owner's messages, the Agent's answers and what Capabilities returned, errors included. It is deleted once the Dream and the Retrospective have read it.
_Avoid_: transcript, history, log

**Retrospective** (it: *Retrospettiva*):
The nightly pass, after the Dream, over how the Agent worked: the Owner's corrections, refused Approvals, failures, requests it couldn't serve. It only makes Proposals; it never changes anything itself.
_Avoid_: self-improvement, feedback loop

**Proposal** (it: *Proposta*):
Something the Retrospective suggests to make the Agent more useful: an instruction for its own behaviour, which becomes confirmed only with the Owner's yes, or an idea, such as an interest to follow or a source to connect, which is the Owner's to act on.
_Avoid_: suggestion, recommendation

### Agent abilities

**Faculty** (it: *Facoltà*):
An innate ability of the Agent that needs nothing installed and comes from the Harness or the Engine: web search, files, shell, Memory, creating Reminders, opening Conversations. The Harness defines what a Faculty means; each Engine implements it in its own way.
_Avoid_: built-in tool, native tool, feature

**Capability** (it: *Capacità*):
An integration with an external system for one specific account (e.g. Gmail · Work). The Owner adds it as a remote MCP server and connects it. The same service connected with two accounts gives two distinct Capabilities.
_Avoid_: integration, connector, extension, tool

**Skill** (it: *Skill*):
A package of know-how (instructions and resources in the open SKILL.md format) that the Agent loads when it needs it.
_Avoid_: competence, prompt, template

**Tool** (it: *Strumento*):
A single action the Agent can invoke, exposed by a Faculty or a Capability. It is the unit a Policy applies to.
_Avoid_: function, command, action

**Plugin** (it: *Plugin*):
A distribution package in the Claude Code plugin format that contains Capabilities and Skills. On install it is broken down into the parts it contains. Non-portable parts (hooks, sub-agents, commands) are not used.
_Avoid_: extension, add-on, module

### Proactivity

**Routine** (it: *Routine*):
A prompt describing a goal, run whenever one of its Triggers fires. The Agent chooses which Faculties, Capabilities and Skills to use to reach the goal.
_Avoid_: job, task, workflow, automation

**Trigger** (it: *Trigger*):
The rule, attached to a Routine, that decides which Events start it: a schedule (specific date, interval, cron) or a webhook.
_Avoid_: hook, listener

**Event** (it: *Evento*):
Something that happens at a specific moment, such as a schedule firing or a webhook arriving, and that can start a Routine.
_Avoid_: signal, notification

**Heartbeat** (it: *Heartbeat*):
A Routine with a periodic Trigger in which the Agent reviews its context and decides on its own whether the Owner is worth contacting. Staying silent is a valid outcome.
_Avoid_: polling, periodic check

**Run** (it: *Esecuzione*):
A single run of a Routine, started by an Event. It can pause while it waits for an Approval.
_Avoid_: job, instance, execution

**Reminder** (it: *Promemoria*):
A Routine created by the Agent itself, with a single Trigger that fires once. It speaks in the Conversation where it was asked for, and is gone once delivered. The Owner may edit or delete it like any Routine. The Agent may create Reminders freely; a recurring Routine created by the Agent needs the Owner's confirmation, until the Owner chooses to allow it.
_Avoid_: alert, alarm

### Control

**Policy** (it: *Policy*):
The rule that decides how the Agent may use a Tool: *allow*, *ask* (needs an Approval) or *deny*.
_Avoid_: permission, rule, ACL

**Approval** (it: *Approvazione*):
The request sent to the Owner before a Tool with an *ask* Policy is used. The Run stays paused until the Owner answers. If they don't answer, the request is repeated once; when it expires, it counts as a denial.
_Avoid_: confirmation, consent

### Communication

**Channel** (it: *Canale*):
The medium the Agent and the Owner exchange messages through, such as Telegram.
_Avoid_: chat, integration, connector

**Conversation** (it: *Conversazione*):
A thread inside a Channel with its own continuous context, such as the "General" topic or a topic dedicated to one subject. Both the Owner and the Agent can open one. Each Routine names the Conversation it delivers its messages to. The context is reset only when the Owner asks for it.
_Avoid_: chat, topic, session, thread

**General Conversation** (it: *Conversazione Generale*):
The Conversation every Channel has from the start, where messages land when no other Conversation is chosen. It can be reset but never closed.
_Avoid_: main chat, default chat, inbox

**Pairing** (it: *Abbinamento*):
Linking the Owner's identity on a Channel to the Harness, so that the Agent only talks to them on that Channel and ignores everyone else.
_Avoid_: login, registration, binding

**Turn** (it: *Turno*):
A single exchange in a Conversation: a message from the Owner and the Agent's reply to it. Messages that arrive during a Turn wait for the next one.
_Avoid_: request, message, run

### Model execution

**Engine** (it: *Motore*):
The replaceable component that lets the Agent reason with a model. It receives the prompt, Faculties, Capabilities, Skills and context, and runs the agentic loop. The Agent does not depend on which Engine is in use.
_Avoid_: provider, backend, LLM, runtime

**Sandbox** (it: *Sandbox*):
The isolated environment where code that the Agent runs, or that comes from third parties, executes: the shell Faculty, local MCP servers and Skill scripts. The Engine's and the Capabilities' secrets cannot be reached from it.
_Avoid_: container, VM, workspace
