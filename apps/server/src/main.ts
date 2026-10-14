/**
 * Composition root: wires Engine, Channel and Conversations together and keeps
 * the Harness running until it receives SIGINT or SIGTERM.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TelegramChannel } from '@emanator/channels/server';
import {
  CONVERSATION_COMMANDS,
  ConversationService,
  ConversationStore,
} from '@emanator/conversations/server';
import { UsageTracker } from '@emanator/engine';
import { ClaudeAgentSdkEngine } from '@emanator/engine/server';
import { consoleLogger, openDatabase } from '@emanator/shared/server';
import { loadConfig } from './config.ts';
import { systemPrompt } from './system-prompt.ts';

const logger = consoleLogger('harness');
const config = loadConfig();

const db = openDatabase(join(config.dataDir, 'state.db'));
const workingDirectory = join(config.dataDir, 'workspace');
mkdirSync(workingDirectory, { recursive: true });

const engine = new ClaudeAgentSdkEngine({
  credentials: config.engineCredentials,
  configDir: join(config.dataDir, 'claude'),
  defaultModel: config.defaultModel,
  defaultWorkingDirectory: workingDirectory,
});

const channel = new TelegramChannel({
  token: config.telegramToken,
  db,
  logger: consoleLogger('telegram'),
});

const conversations = new ConversationService({
  channel,
  engine,
  store: new ConversationStore(db),
  usage: new UsageTracker(),
  systemPrompt: () => systemPrompt(new Date(), config.timeZone),
  defaultModel: config.defaultModel,
  timeZone: config.timeZone,
  logger: consoleLogger('conversations'),
});

await channel.setCommands(CONVERSATION_COMMANDS);
await channel.start((event) => conversations.handle(event));
logger.info('Emanator is running', { model: config.defaultModel, timeZone: config.timeZone });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info(`${signal} received, stopping`);
  await channel.stop();
  await conversations.idle();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
