import { randomUUID } from 'node:crypto';
import type { SessionRef } from '@emanator/engine';
import { type Database, runMigrations } from '@emanator/shared/server';
import {
  type Conversation,
  GENERAL_CONVERSATION_NAME,
  type OpenedBy,
  ROUTINE_TOPIC_SUFFIX,
} from '../domain/conversation.ts';
import { conversationMigrations } from './migrations.ts';

export interface NewConversation {
  /** Preferred name; creation adds a numeric suffix if a live Conversation holds it. */
  name: string;
  title: string;
  channel: string;
  threadId?: string;
  openedBy: OpenedBy;
  /** Only a Routine's own topic may take a name ending in `-routine`. */
  routineTopic?: boolean;
}

/** A message a Routine delivered, to be handed to the Conversation on its next turn. */
export interface Handoff {
  id: string;
  markdown: string;
  createdAt: Date;
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

  /** Any Conversation by id, archived ones included. */
  async get(id: string): Promise<Conversation | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM conversations WHERE id = $1', [id]);
    return row ? toConversation(row) : undefined;
  }

  /** The live Conversation with this name. */
  async findByName(name: string): Promise<Conversation | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM conversations WHERE name = $1 AND archived_at IS NULL', [
      name,
    ]);
    return row ? toConversation(row) : undefined;
  }

  /**
   * Atomically claims `name`, or `name-2`, `name-3`, … if a live Conversation holds it.
   * Only the General thread may be called `general`, and only Routine topics end in `-routine`.
   */
  async create(input: NewConversation): Promise<Conversation> {
    const { routineTopic, ...fields } = input;
    const conversation: Conversation = {
      id: randomUUID(),
      ...fields,
      createdAt: new Date(),
    };
    for (let n = 1; ; n++) {
      const name = n === 1 ? input.name : `${input.name}-${n}`;
      if (name === GENERAL_CONVERSATION_NAME && input.threadId !== undefined) continue;
      if (name.endsWith(ROUTINE_TOPIC_SUFFIX) && !routineTopic) continue;
      const { rows } = await this.db.query(
        `INSERT INTO conversations (id, name, title, channel, thread_id, opened_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name) WHERE archived_at IS NULL DO NOTHING
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

  /** Adds a handoff and keeps only the newest `keep` of the Conversation's. */
  async addHandoff(conversationId: string, markdown: string, keep: number): Promise<void> {
    await this.db.query(
      'INSERT INTO conversation_handoffs (id, conversation_id, markdown, created_at) VALUES ($1, $2, $3, $4)',
      [randomUUID(), conversationId, markdown, new Date()],
    );
    await this.db.query(
      `DELETE FROM conversation_handoffs WHERE conversation_id = $1 AND id NOT IN (
         SELECT id FROM conversation_handoffs WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2
       )`,
      [conversationId, keep],
    );
  }

  /** Handoffs not yet given to the Engine, oldest first. */
  async pendingHandoffs(conversationId: string): Promise<Handoff[]> {
    const { rows } = await this.db.query(
      'SELECT id, markdown, created_at FROM conversation_handoffs WHERE conversation_id = $1 ORDER BY created_at, id',
      [conversationId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      markdown: String(row.markdown),
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    }));
  }

  /** Drops the given handoffs, or all of the Conversation's when `ids` is omitted. */
  async clearHandoffs(conversationId: string, ids?: readonly string[]): Promise<void> {
    if (ids) {
      await this.db.query(
        'DELETE FROM conversation_handoffs WHERE conversation_id = $1 AND id = ANY($2)',
        [conversationId, ids],
      );
    } else {
      await this.db.query('DELETE FROM conversation_handoffs WHERE conversation_id = $1', [
        conversationId,
      ]);
    }
  }

  /** Throws if a live Conversation already holds `name`. */
  async rename(id: string, name: string, title: string): Promise<void> {
    await this.db.query('UPDATE conversations SET name = $2, title = $3 WHERE id = $1', [
      id,
      name,
      title,
    ]);
  }

  async archive(id: string): Promise<void> {
    await this.db.query('UPDATE conversations SET archived_at = $1 WHERE id = $2', [
      new Date(),
      id,
    ]);
  }
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
