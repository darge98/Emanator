import { randomUUID } from 'node:crypto';
import {
  type Database,
  type Logger,
  runMigrations,
  silentLogger,
  transaction,
} from '@emanator/shared/server';
import type {
  Capability,
  CapabilityInput,
  CapabilityStatus,
  CapabilityTool,
  NewCapabilityInput,
} from '../domain/capability.ts';
import { capabilityMigrations } from './migrations.ts';
import type { SecretBox } from './secret-box.ts';

type Row = Record<string, unknown>;

/** What the OAuth client needs, opened: the store keeps it sealed. Stored as the SDK gave it. */
export interface CapabilityCredentials {
  clientSecret?: string;
  clientInformation?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
}

export type CredentialKind = 'client' | 'tokens';

/** The columns that hold values sealed by SecretBox. */
type SealedColumn = 'client_secret' | 'client_information' | 'tokens';

/**
 * The `updatedAt` a Capability had when a connection began. Writes that pass it land only if
 * nobody edited or deleted the Capability meanwhile: the edit wins over the old connection.
 */
export type Version = Date | undefined;

/** An authorization the Owner started in the browser. */
export interface PendingAuthorization {
  capabilityId: string;
  codeVerifier: string;
}

/** Another Capability already has this slug. */
export class CapabilitySlugTakenError extends Error {
  override name = 'CapabilitySlugTakenError';
  constructor(readonly slug: string) {
    super(`A Capability with the slug "${slug}" already exists.`);
  }
}

/** Capabilities are configuration, their connections runtime state; both in PostgreSQL (ADR 0007). */
export class CapabilityStore {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
    private readonly logger: Logger = silentLogger,
  ) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'capabilities', capabilityMigrations);
  }

  async list(): Promise<Capability[]> {
    const { rows } = await this.db.query('SELECT * FROM capabilities ORDER BY created_at, id');
    return rows.map(toCapability);
  }

  async get(id: string): Promise<Capability | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM capabilities WHERE id = $1', [id]);
    return row ? toCapability(row) : undefined;
  }

  /** The Capability made from a catalog entry, if the Owner connected it. */
  async getByCatalog(catalogId: string): Promise<Capability | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM capabilities WHERE catalog_id = $1', [catalogId]);
    return row ? toCapability(row) : undefined;
  }

  async create(input: NewCapabilityInput, catalogId?: string): Promise<Capability> {
    const now = new Date();
    const {
      rows: [row],
    } = await this.withSlug(input.slug, () =>
      this.db.query(
        `INSERT INTO capabilities
           (id, slug, title, url, scopes, enabled, client_id, client_secret, created_at, updated_at,
            catalog_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10) RETURNING *`,
        [
          randomUUID(),
          input.slug,
          input.title,
          input.url,
          JSON.stringify(input.scopes),
          input.enabled,
          input.clientId ?? null,
          input.clientSecret ? this.secrets.seal(input.clientSecret) : null,
          now,
          catalogId ?? null,
        ],
      ),
    );
    return toCapability(row as Row);
  }

  /**
   * Returns undefined when the Capability doesn't exist. Changing the server, the client or
   * the scopes drops the connection: the tokens were granted for the old ones.
   */
  async update(id: string, input: CapabilityInput): Promise<Capability | undefined> {
    return transaction(this.db, async (client) => {
      const {
        rows: [current],
      } = await client.query('SELECT * FROM capabilities WHERE id = $1 FOR UPDATE', [id]);
      if (!current) return undefined;

      const clientId = input.clientId ?? null;
      const clientChanged = clientId !== current.client_id;
      // A secret belongs to its client, so a new client ID doesn't inherit the old one.
      const clientSecret =
        input.clientSecret === undefined
          ? clientChanged
            ? null
            : (current.client_secret as string | null)
          : input.clientSecret
            ? this.secrets.seal(input.clientSecret)
            : null;
      // One sealed under another key can't be compared, so it counts as changed.
      const storedSecret =
        current.client_secret === null ? '' : this.tryOpen(current.client_secret);
      const secretChanged = input.clientSecret !== undefined && input.clientSecret !== storedSecret;
      const urlChanged = input.url !== current.url;
      const reconnect =
        urlChanged ||
        clientChanged ||
        secretChanged ||
        JSON.stringify(input.scopes) !== JSON.stringify(current.scopes);
      if (reconnect) {
        // An authorization still in the browser was started for the old settings.
        await client.query('DELETE FROM capability_authorizations WHERE capability_id = $1', [id]);
      }
      if (urlChanged) {
        await client.query('DELETE FROM capability_tools WHERE capability_id = $1', [id]);
      }

      const {
        rows: [row],
      } = await client.query(
        `UPDATE capabilities SET title = $2, url = $3, scopes = $4, enabled = $5, client_id = $6,
           client_secret = $7, updated_at = $8,
           client_information = CASE WHEN $9 THEN NULL ELSE client_information END,
           tokens = CASE WHEN $9 THEN NULL ELSE tokens END,
           status = CASE WHEN $9 THEN 'disconnected' ELSE status END,
           last_error = CASE WHEN $9 THEN NULL ELSE last_error END
         WHERE id = $1 RETURNING *`,
        [
          id,
          input.title,
          input.url,
          JSON.stringify(input.scopes),
          input.enabled,
          clientId,
          clientSecret,
          new Date(),
          reconnect,
        ],
      );
      return toCapability(row as Row);
    });
  }

  /** Deletes the Capability with its secrets and returns it, or undefined if it didn't exist. */
  async delete(id: string): Promise<Capability | undefined> {
    const {
      rows: [row],
    } = await this.db.query('DELETE FROM capabilities WHERE id = $1 RETURNING *', [id]);
    return row ? toCapability(row) : undefined;
  }

  async credentials(id: string): Promise<CapabilityCredentials> {
    const {
      rows: [row],
    } = await this.db.query(
      'SELECT client_secret, client_information, tokens FROM capabilities WHERE id = $1',
      [id],
    );
    if (!row) return {};
    const clientSecret = await this.openOrForget(id, 'client_secret', row.client_secret);
    const clientInformation = await this.openOrForget(
      id,
      'client_information',
      row.client_information,
    );
    const tokens = await this.openOrForget(id, 'tokens', row.tokens);
    return {
      ...(clientSecret !== undefined && { clientSecret }),
      ...(clientInformation !== undefined && { clientInformation: JSON.parse(clientInformation) }),
      ...(tokens !== undefined && { tokens: JSON.parse(tokens) }),
    };
  }

  async saveClientInformation(
    id: string,
    information: Record<string, unknown>,
    version?: Version,
  ): Promise<void> {
    await this.db.query(
      `UPDATE capabilities SET client_information = $2
       WHERE id = $1 AND ($3::timestamptz IS NULL OR updated_at = $3)`,
      [id, this.secrets.seal(JSON.stringify(information)), version ?? null],
    );
  }

  async saveTokens(id: string, tokens: Record<string, unknown>, version?: Version): Promise<void> {
    await this.db.query(
      `UPDATE capabilities SET tokens = $2
       WHERE id = $1 AND ($3::timestamptz IS NULL OR updated_at = $3)`,
      [id, this.secrets.seal(JSON.stringify(tokens)), version ?? null],
    );
  }

  /** Forgets credentials the server refused; tokens go with the client they were issued to. */
  async forgetCredentials(id: string, kind: CredentialKind): Promise<void> {
    await this.db.query(
      kind === 'client'
        ? 'UPDATE capabilities SET client_information = NULL, tokens = NULL WHERE id = $1'
        : 'UPDATE capabilities SET tokens = NULL WHERE id = $1',
      [id],
    );
  }

  /**
   * Sets the connection status and returns the previous one; undefined if there's no such
   * Capability, or it changed since `version`.
   */
  async setStatus(
    id: string,
    status: CapabilityStatus,
    error?: string,
    version?: Version,
  ): Promise<CapabilityStatus | undefined> {
    const {
      rows: [row],
    } = await this.db.query(
      `UPDATE capabilities AS c SET status = $2, last_error = $3
       FROM (SELECT status FROM capabilities WHERE id = $1 FOR UPDATE) AS previous
       WHERE c.id = $1 AND ($4::timestamptz IS NULL OR c.updated_at = $4)
       RETURNING previous.status AS previous`,
      [id, status, error ?? null, version ?? null],
    );
    return row ? (row.previous as CapabilityStatus) : undefined;
  }

  /** Also drops the authorizations older than `maxAgeMs`, which the browser abandoned. */
  async savePendingAuthorization(
    state: string,
    capabilityId: string,
    codeVerifier: string,
    maxAgeMs: number,
  ): Promise<void> {
    await this.db.query('DELETE FROM capability_authorizations WHERE created_at < $1', [
      new Date(Date.now() - maxAgeMs),
    ]);
    await this.db.query(
      `INSERT INTO capability_authorizations (state, capability_id, code_verifier, created_at)
       VALUES ($1, $2, $3, $4)`,
      [state, capabilityId, this.secrets.seal(codeVerifier), new Date()],
    );
  }

  /** Takes an authorization out once: a state can't be replayed. Older ones count as gone. */
  async takePendingAuthorization(
    state: string,
    maxAgeMs: number,
  ): Promise<PendingAuthorization | undefined> {
    const {
      rows: [row],
    } = await this.db.query('DELETE FROM capability_authorizations WHERE state = $1 RETURNING *', [
      state,
    ]);
    if (!row || Date.now() - (row.created_at as Date).getTime() > maxAgeMs) return undefined;
    const codeVerifier = this.tryOpen(row.code_verifier);
    if (codeVerifier === undefined) return undefined;
    return { capabilityId: String(row.capability_id), codeVerifier };
  }

  /** The cached Tools of every Capability, in the order their servers listed them. */
  async tools(): Promise<Map<string, CapabilityTool[]>> {
    const { rows } = await this.db.query(
      'SELECT * FROM capability_tools ORDER BY capability_id, position',
    );
    const tools = new Map<string, CapabilityTool[]>();
    for (const row of rows) {
      const id = String(row.capability_id);
      tools.set(id, [...(tools.get(id) ?? []), toTool(row)]);
    }
    return tools;
  }

  /** Returns false, writing nothing, when the Capability is gone or changed since `version`. */
  async replaceTools(
    capabilityId: string,
    tools: readonly CapabilityTool[],
    version?: Version,
  ): Promise<boolean> {
    return transaction(this.db, async (client) => {
      const { rowCount } = await client.query(
        `SELECT 1 FROM capabilities
         WHERE id = $1 AND ($2::timestamptz IS NULL OR updated_at = $2) FOR UPDATE`,
        [capabilityId, version ?? null],
      );
      if (!rowCount) return false;
      await client.query('DELETE FROM capability_tools WHERE capability_id = $1', [capabilityId]);
      for (const [position, tool] of tools.entries()) {
        await client.query(
          `INSERT INTO capability_tools
             (capability_id, name, position, title, description, input_schema, hints)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            capabilityId,
            tool.name,
            position,
            tool.title,
            tool.description,
            JSON.stringify(tool.inputSchema),
            JSON.stringify(tool.hints),
          ],
        );
      }
      return true;
    });
  }

  /** Undefined when the value was sealed under another key, e.g. after EMANATOR_SECRET_KEY changed. */
  private tryOpen(value: unknown): string | undefined {
    try {
      return this.secrets.open(String(value));
    } catch {
      return undefined;
    }
  }

  /**
   * Opens a stored secret. One sealed under another key is useless, so it is forgotten: the
   * Capability then asks to be connected again, instead of failing every time it is used.
   */
  private async openOrForget(
    id: string,
    column: SealedColumn,
    value: unknown,
  ): Promise<string | undefined> {
    if (value === null || value === undefined) return undefined;
    const opened = this.tryOpen(value);
    if (opened !== undefined) return opened;
    await this.db.query(`UPDATE capabilities SET ${column} = NULL WHERE id = $1`, [id]);
    this.logger.warn('Forgot a Capability secret sealed under another EMANATOR_SECRET_KEY', {
      capability: id,
      secret: column,
    });
    return undefined;
  }

  private async withSlug<T>(slug: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new CapabilitySlugTakenError(slug);
      throw error;
    }
  }
}

function toCapability(row: Row): Capability {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    url: String(row.url),
    scopes: row.scopes as string[],
    enabled: Boolean(row.enabled),
    ...(row.client_id !== null && { clientId: String(row.client_id) }),
    hasClientSecret: row.client_secret !== null,
    status: row.status as CapabilityStatus,
    ...(row.catalog_id !== null &&
      row.catalog_id !== undefined && {
        catalogId: String(row.catalog_id),
      }),
    ...(row.last_error !== null && { lastError: String(row.last_error) }),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toTool(row: Row): CapabilityTool {
  return {
    name: String(row.name),
    title: String(row.title),
    description: String(row.description),
    inputSchema: row.input_schema as CapabilityTool['inputSchema'],
    hints: row.hints as CapabilityTool['hints'],
  };
}
