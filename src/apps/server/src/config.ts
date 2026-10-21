import { join } from 'node:path';
import { SecretBox } from '@emanator/capabilities/server';
import { DEFAULT_MODEL, isModel, MODELS, type ModelId } from '@emanator/engine';
import { type EngineCredentials, engineCredentialsFromEnv } from '@emanator/engine/server';

export interface HarnessConfig {
  dataDir: string;
  telegramToken: string;
  engineCredentials: EngineCredentials;
  /** The default model's first value; the Owner changes it in the dashboard. */
  initialModel: ModelId;
  timeZone: string;
  databaseUrl: string;
  httpHost: string;
  httpPort: number;
  /** How the Owner's browser reaches the dashboard; OAuth redirects come back here. */
  dashboardUrl: string;
  secrets: SecretBox;
}

/** Everything the Harness needs from `.env`; fails fast on what's missing. */
export function loadConfig(env: Record<string, string | undefined> = process.env): HarnessConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error('Set DATABASE_URL to a PostgreSQL connection URL.');
  }
  const httpPort = Number(env.EMANATOR_HTTP_PORT ?? 3000);
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error('EMANATOR_HTTP_PORT must be an integer between 1 and 65535.');
  }
  const httpHost = env.EMANATOR_HTTP_HOST?.trim() || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(httpHost)) {
    throw new Error('EMANATOR_HTTP_HOST must be a loopback address or 0.0.0.0 inside Docker.');
  }
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramToken) {
    throw new Error('Set TELEGRAM_BOT_TOKEN in .env (create the bot with @BotFather).');
  }
  const dashboardUrl = (
    env.EMANATOR_DASHBOARD_URL?.trim() || `http://127.0.0.1:${httpPort}`
  ).replace(/\/+$/, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(dashboardUrl)) {
    throw new Error(
      'EMANATOR_DASHBOARD_URL must be a loopback address, e.g. http://127.0.0.1:3000.',
    );
  }
  const initialModel = env.EMANATOR_MODEL?.trim() || DEFAULT_MODEL;
  if (!isModel(initialModel)) {
    throw new Error(`EMANATOR_MODEL must be one of: ${MODELS.map(({ id }) => id).join(', ')}.`);
  }
  const timeZone = env.EMANATOR_TIMEZONE?.trim() || 'Europe/Rome';
  // Throws a RangeError on an unknown zone, before anything starts.
  new Intl.DateTimeFormat('it-IT', { timeZone });

  return {
    databaseUrl,
    httpHost,
    httpPort,
    dashboardUrl,
    secrets: SecretBox.fromEnv(env),
    dataDir: env.EMANATOR_DATA_DIR?.trim() || join(process.cwd(), 'data'),
    telegramToken,
    engineCredentials: engineCredentialsFromEnv(env),
    initialModel,
    timeZone,
  };
}
