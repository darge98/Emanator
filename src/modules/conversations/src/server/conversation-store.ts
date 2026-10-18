import { randomUUID } from 'node:crypto';
import type { SessionRef } from '@emanator/engine';
import { type Database, runMigrations } from '@emanator/shared/server';
import type { Conversation, OpenedBy } from '../domain/conversation.ts';
import { conversationMigrations } from './migrations.ts';

export interface NewConversation {
  /** Preferred name; creation adds a numeric suffix if this name is already reserved. */
  name: string;
  title: string;
  channel: string;
  threadId?: string;
  openedBy: OpenedBy;
}

/** Conversations are runtime state in PostgreSQL, not definitions (ADR 0007). */
export class ConversationStore {
  constructor(private readonly db: Database) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'conversations', conversationMigrations);
  }

  /** The live Conversation of a thread; `threadId` undefined means the General thread. */
  async findByThread(
    channel: string,
    threadId: string | undefined,
  ): Promise<Conversation | undefined> {
    const {
      rows: [row],
    } = await this.db.query(
      `SELECT * FROM conversations WHERE channel = $1 AND COALESCE(thread_id, '') = COALESCE($2, '') AND archived_at IS NULL`,
      [channel, threadId ?? null],
    );
    return row ? toConversation(row) : undefined;
  }

  async findByName(name: string): Promise<Conversation | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM conversations WHERE name = $1', [name]);
    return row ? toConversation(row) : undefined;
  }

  /** Atomically claims `name`, or `name-2`, `name-3`, …; archived names stay reserved. */
  async create(input: NewConversation): Promise<Conversation> {
    const conversation: Conversation = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
    };
    for (let n = 1; ; n++) {
      const name = n === 1 ? input.name : `${input.name}-${n}`;
      const { rows } = await this.db.query(
        `INSERT INTO conversations (id, name, title, channel, thread_id, opened_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name) DO NOTHING
         RETURNING *`,
        [
          conversation.id,
          name,
          conversation.title,
          conversation.channel,
          conversation.threadId ?? null,
          conversation.openedBy,
          conversation.createdAt.toISOString(),
        ],
      );
      // Retry only a name collision; thread uniqueness and other failures still propagate.
      if (rows[0]) return toConversation(rows[0]);
    }
  }

  /** Stores the Engine session to resume, or clears it to start fresh. */
  async setSession(id: string, session: SessionRef | undefined): Promise<void> {
    await this.db.query(
      'UPDATE conversations SET session_engine = $1, session_id = $2 WHERE id = $3',
      [session?.engine ?? null, session?.id ?? null, id],
    );
  }

  async archive(id: string): Promise<void> {
    await this.db.query('UPDATE conversations SET archived_at = $1 WHERE id = $2', [
      new Date(),
      id,
    ]);
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
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    ...(row.archived_at !== null && {
      archivedAt:
        row.archived_at instanceof Date ? row.archived_at : new Date(String(row.archived_at)),
    }),
  };
}
