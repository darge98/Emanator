# Modular monolith organised as vertical feature slices

The code is a pnpm monorepo where each feature is a package named after a glossary term: `engine`, `capabilities`, `routines`, `conversations`, `channels`, and so on. Each package is a complete vertical slice: domain, server API and UI pages for that feature, exposed as separate entry points (`@emanator/<feature>/server` and `@emanator/<feature>/web`) so server code never ends up in the browser bundle.

Ports and adapters live inside their feature, for example `engine/adapters/claude-agent-sdk` and `channels/adapters/telegram`. Each feature owns its PostgreSQL tables and migrations. Skills and Memory remain files. Features talk to each other only through their public API and in-process domain events. `apps/server` and `apps/web` compose the features, and `shared` holds only infrastructure (PostgreSQL connection, file helpers, event bus).

The goal is that anything about a concept, such as the Engine, can be found in a single folder.

## Considered Options

- **Server and web modules mirrored under the two apps**: simpler monorepo setup, but every feature would be split across two folders.
- **One package per adapter** (e.g. `engine-claude-agent-sdk`): isolates heavy dependencies and would let third parties publish adapters on npm, at the cost of many more packages. It can be done later by extracting a single adapter.
