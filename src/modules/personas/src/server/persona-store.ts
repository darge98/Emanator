import type { Database } from '@emanator/shared/server';
import { runMigrations } from '@emanator/shared/server';
import { DEFAULT_PERSONA, type Persona, validatePersona } from '../domain/persona.ts';

export class PersonaStore {
  constructor(private readonly db: Database) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'personas', [
      {
        id: '001-persona',
        sql: `
      CREATE TABLE persona_config (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        name TEXT NOT NULL,
        personality TEXT NOT NULL
      );
    `,
      },
    ]);
    await this.db.query(
      `INSERT INTO persona_config (singleton, name, personality) VALUES (TRUE, $1, $2)
       ON CONFLICT (singleton) DO NOTHING`,
      [DEFAULT_PERSONA.name, DEFAULT_PERSONA.personality],
    );
  }

  async get(): Promise<Persona> {
    const { rows } = await this.db.query(
      'SELECT name, personality FROM persona_config WHERE singleton = TRUE',
    );
    const row = rows[0];
    return row ? { name: String(row.name), personality: String(row.personality) } : DEFAULT_PERSONA;
  }

  async save(input: unknown): Promise<Persona> {
    const persona = validatePersona(input);
    await this.db.query(
      `INSERT INTO persona_config (singleton, name, personality) VALUES (TRUE, $1, $2)
      ON CONFLICT (singleton) DO UPDATE SET name = EXCLUDED.name, personality = EXCLUDED.personality`,
      [persona.name, persona.personality],
    );
    return persona;
  }
}
