import { join } from 'node:path';
import { type EngineCredentials, engineCredentialsFromEnv } from '@emanator/engine/server';

export interface HarnessConfig {
  dataDir: string;
  telegramToken: string;
  engineCredentials: EngineCredentials;
  defaultModel: string;
  timeZone: string;
}

/** Everything the Harness needs from `.env`; fails fast on what's missing. */
export function loadConfig(env: Record<string, string | undefined> = process.env): HarnessConfig {
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramToken) {
    throw new Error('Set TELEGRAM_BOT_TOKEN in .env (create the bot with @BotFather).');
  }
  const timeZone = env.EMANATOR_TIMEZONE?.trim() || 'Europe/Rome';
  // Throws a RangeError on an unknown zone, before anything starts.
  new Intl.DateTimeFormat('it-IT', { timeZone });

  return {
    dataDir: env.EMANATOR_DATA_DIR?.trim() || join(process.cwd(), 'data'),
    telegramToken,
    engineCredentials: engineCredentialsFromEnv(env),
    defaultModel: env.EMANATOR_MODEL?.trim() || 'sonnet',
    timeZone,
  };
}
