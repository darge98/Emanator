import { randomInt } from 'node:crypto';
import type { Database } from '@emanator/shared/server';

export interface TelegramOwner {
  userId: number;
  chatId: number;
}

// No look-alike characters (0/O, 1/I/L), so the code is easy to copy from a log.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * Pairing of the Owner's Telegram account. Until someone sends `/start <code>`
 * with the one-time code, the bot talks to nobody. The code lives only in memory
 * and changes at every start.
 */
export class TelegramPairing {
  private readonly code: string | undefined;

  constructor(private readonly db: Database) {
    this.code = this.owner() ? undefined : generateCode();
  }

  owner(): TelegramOwner | undefined {
    const row = this.db.prepare('SELECT user_id, chat_id FROM telegram_owner').get();
    return row ? { userId: Number(row.user_id), chatId: Number(row.chat_id) } : undefined;
  }

  /** The code to show the Owner, or undefined once paired. */
  pendingCode(): string | undefined {
    return this.owner() ? undefined : this.code;
  }

  /** Pairs the sender if the code matches; returns whether it did. */
  pair(code: string, owner: TelegramOwner): boolean {
    const expected = this.pendingCode();
    if (!expected || code.trim().toUpperCase() !== expected) return false;
    this.db
      .prepare(
        'INSERT INTO telegram_owner (singleton, user_id, chat_id, paired_at) VALUES (1, ?, ?, ?)',
      )
      .run(owner.userId, owner.chatId, new Date().toISOString());
    return true;
  }
}

function generateCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}
