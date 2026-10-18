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
import { PersonaStore } from '@emanator/personas/server';
import { ApprovalService, PolicyService, PolicyStore } from '@emanator/policies/server';
import { RoutineRunner, RoutineService, RoutineStore } from '@emanator/routines/server';
import { consoleLogger, openDatabase } from '@emanator/shared/server';
import { loadConfig } from './config.ts';
import { createDashboardServer } from './dashboard-server.ts';
import { systemPrompt } from './system-prompt.ts';

const logger = consoleLogger('harness');
const config = loadConfig();

const db = await openDatabase(config.databaseUrl);
try {
  await start();
} catch (error) {
  await db.end();
  throw error;
}

async function start() {
  const personas = new PersonaStore(db);
  await personas.init();
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
  await channel.init();
  const store = new ConversationStore(db);
  await store.init();

  const policyStore = new PolicyStore(db);
  await policyStore.init();
  const approvals = new ApprovalService({
    channel,
    store: policyStore,
    logger: consoleLogger('approvals'),
  });
  await approvals.init();
  // No Tools are declared yet, so every Tool is denied; Faculties are next.
  const policies = new PolicyService({
    store: policyStore,
    approvals,
    tools: () => [],
    logger: consoleLogger('policies'),
  });
  const permissions = policies.decider.bind(policies);

  const usage = new UsageTracker();
  const agentPrompt = async () => {
    const persona = await personas.get();
    return systemPrompt(new Date(), config.timeZone, persona);
  };
  const conversations = new ConversationService({
    channel,
    engine,
    store,
    usage,
    permissions,
    systemPrompt: agentPrompt,
    defaultModel: config.defaultModel,
    timeZone: config.timeZone,
    logger: consoleLogger('conversations'),
  });

  const routineStore = new RoutineStore(db);
  await routineStore.init();
  const routineLogger = consoleLogger('routines');
  const routines = new RoutineService({
    store: routineStore,
    runner: new RoutineRunner({
      engine,
      conversations,
      store: routineStore,
      usage,
      permissions,
      systemPrompt: agentPrompt,
      defaultModel: config.defaultModel,
      timeZone: config.timeZone,
      logger: routineLogger,
    }),
    conversations,
    timeZone: config.timeZone,
    logger: routineLogger,
  });

  const dashboard = await createDashboardServer({
    personas,
    routines,
    policies,
    logger: consoleLogger('dashboard'),
  });
  try {
    await dashboard.listen({ host: config.httpHost, port: config.httpPort });
    await channel.setCommands(CONVERSATION_COMMANDS);
    await channel.start((event) => {
      // Presses answer turns that may hold their Conversation's queue: they skip it.
      if (event.type === 'action') void approvals.answer(event);
      else conversations.handle(event);
    });
    await routines.start();
    logger.info('Emanator is running', {
      model: config.defaultModel,
      timeZone: config.timeZone,
      dashboard: `http://localhost:${config.httpPort}`,
    });
  } catch (error) {
    await dashboard.close();
    throw error;
  }

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, stopping`);
    await dashboard.close();
    // Pending Approvals expire first, or their turns would keep the steps below waiting.
    await approvals.stop();
    await routines.stop();
    await channel.stop();
    await conversations.idle();
    await db.end();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
