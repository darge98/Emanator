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
  private pairedOwner: TelegramOwner | undefined;

  constructor(private readonly db: Database) {
    this.code = generateCode();
  }

  async init(): Promise<void> {
    this.pairedOwner = await this.owner();
  }

  async owner(): Promise<TelegramOwner | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT user_id, chat_id FROM telegram_owner WHERE singleton = 1');
    return row ? { userId: Number(row.user_id), chatId: Number(row.chat_id) } : undefined;
  }

  /** The code to show the Owner, or undefined once paired. */
  pendingCode(): string | undefined {
    return this.pairedOwner ? undefined : this.code;
  }

  /** Pairs the sender if the code matches; returns whether it did. */
  async pair(code: string, owner: TelegramOwner): Promise<boolean> {
    const expected = this.pendingCode();
    if (!expected || code.trim().toUpperCase() !== expected) return false;
    const result = await this.db.query(
      'INSERT INTO telegram_owner (singleton, user_id, chat_id, paired_at) VALUES (1, $1, $2, $3) ON CONFLICT DO NOTHING',
      [owner.userId, owner.chatId, new Date()],
    );
    if (result.rowCount !== 1) {
      this.pairedOwner = await this.owner();
      return false;
    }
    this.pairedOwner = owner;
    return true;
  }
}

function generateCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}
