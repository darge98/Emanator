import { randomUUID } from 'node:crypto';
import type { SessionRef } from '@emanator/engine';
import { type Database, runMigrations } from '@emanator/shared/server';
import type { Conversation, OpenedBy } from '../domain/conversation.ts';
import { conversationMigrations } from './migrations.ts';

export interface NewConversation {
  name: string;
  title: string;
  channel: string;
  threadId?: string;
  openedBy: OpenedBy;
}

/** Conversations are runtime state in SQLite, not definitions (ADR 0003). */
export class ConversationStore {
  constructor(private readonly db: Database) {
    runMigrations(db, 'conversations', conversationMigrations);
  }

  /** The live Conversation of a thread; `threadId` undefined means the General thread. */
  findByThread(channel: string, threadId: string | undefined): Conversation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE channel = ? AND ifnull(thread_id, '') = ? AND archived_at IS NULL`,
      )
      .get(channel, threadId ?? '');
    return row ? toConversation(row) : undefined;
  }

  findByName(name: string): Conversation | undefined {
    const row = this.db.prepare('SELECT * FROM conversations WHERE name = ?').get(name);
    return row ? toConversation(row) : undefined;
  }

  create(input: NewConversation): Conversation {
    const conversation: Conversation = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
    };
    this.db
      .prepare(
        `INSERT INTO conversations (id, name, title, channel, thread_id, opened_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.name,
        conversation.title,
        conversation.channel,
        conversation.threadId ?? null,
        conversation.openedBy,
        conversation.createdAt.toISOString(),
      );
    return conversation;
  }

  /** Stores the Engine session to resume, or clears it to start fresh. */
  setSession(id: string, session: SessionRef | undefined): void {
    this.db
      .prepare('UPDATE conversations SET session_engine = ?, session_id = ? WHERE id = ?')
      .run(session?.engine ?? null, session?.id ?? null, id);
  }

  archive(id: string): void {
    this.db
      .prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /** `base`, or `base-2`, `base-3`, … if taken. Names stay reserved after archiving. */
  availableName(base: string): string {
    const taken = (name: string) =>
      this.db.prepare('SELECT 1 FROM conversations WHERE name = ?').get(name) !== undefined;
    let name = base;
    for (let n = 2; taken(name); n++) name = `${base}-${n}`;
    return name;
  }
}

/** Turns a title into a stable name: `Viaggio in Giappone` -> `viaggio-in-giappone`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'topic';
}

function toConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    name: String(row.name),
    title: String(row.title),
    channel: String(row.channel),
    ...(row.thread_id !== null && { threadId: String(row.thread_id) }),
    ...(row.session_id !== null && {
      session: { engine: String(row.session_engine), id: String(row.session_id) },
    }),
    ...(row.model !== null && { model: String(row.model) }),
    openedBy: String(row.opened_by) as OpenedBy,
    createdAt: new Date(String(row.created_at)),
    ...(row.archived_at !== null && { archivedAt: new Date(String(row.archived_at)) }),
  };
}
