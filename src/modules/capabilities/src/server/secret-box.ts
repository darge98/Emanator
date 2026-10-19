import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts the Capabilities' secrets (client secrets, OAuth tokens) before they reach
 * PostgreSQL, so a copy of the database alone doesn't open the Owner's accounts.
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** Reads `EMANATOR_SECRET_KEY`: 32 bytes in base64, e.g. from `openssl rand -base64 32`. */
  static fromEnv(env: Record<string, string | undefined> = process.env): SecretBox {
    const encoded = env.EMANATOR_SECRET_KEY?.trim();
    if (!encoded) {
      throw new Error(
        'Set EMANATOR_SECRET_KEY in .env: it encrypts Capability secrets. Generate one with `openssl rand -base64 32`.',
      );
    }
    return SecretBox.fromKey(Buffer.from(encoded, 'base64'));
  }

  static fromKey(key: Buffer): SecretBox {
    if (key.length !== 32) {
      throw new Error('EMANATOR_SECRET_KEY must be 32 bytes, base64-encoded.');
    }
    return new SecretBox(key);
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), sealed].map(encode).join(':');
  }

  /** Throws when the value was sealed with another key or has been tampered with. */
  open(value: string): string {
    const [version, iv, tag, sealed] = value.split(':');
    if (version !== VERSION || !iv || !tag || sealed === undefined) {
      throw new Error('Not a sealed secret.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function encode(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64');
}
