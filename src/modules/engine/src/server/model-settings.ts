import { type Database, runMigrations } from '@emanator/shared/server';
import { isModel, MODELS, type ModelId } from '../domain/models.ts';

/** A model the dashboard sent that isn't in the list. */
export class ModelSettingsError extends Error {
  override readonly name = 'ModelSettingsError';
  constructor() {
    super(`The model must be one of: ${MODELS.map(({ id }) => id).join(', ')}.`);
  }
}

/**
 * The default model, which the Owner sets in the dashboard; `.env` gives only its first value.
 * Kept in memory too, so every turn reads it without a query and a save applies to the next.
 */
export class ModelSettings {
  private current: ModelId;

  constructor(
    private readonly db: Database,
    initial: ModelId,
  ) {
    this.current = initial;
  }

  async init(): Promise<void> {
    await runMigrations(this.db, 'engine', [
      {
        id: '001-model-settings',
        sql: `
          CREATE TABLE engine_settings (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            default_model TEXT NOT NULL
          );
        `,
      },
    ]);
    await this.db.query(
      'INSERT INTO engine_settings (id, default_model) VALUES (1, $1) ON CONFLICT DO NOTHING',
      [this.current],
    );
    const {
      rows: [row],
    } = await this.db.query('SELECT default_model FROM engine_settings WHERE id = 1');
    if (isModel(row?.default_model)) this.current = row.default_model;
  }

  defaultModel(): ModelId {
    return this.current;
  }

  async setDefaultModel(model: unknown): Promise<ModelId> {
    if (!isModel(model)) throw new ModelSettingsError();
    await this.db.query('UPDATE engine_settings SET default_model = $1 WHERE id = 1', [model]);
    this.current = model;
    return model;
  }
}
