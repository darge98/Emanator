/**
 * Composition root: wires Engine, Channel and Conversations together and keeps
 * the Harness running until it receives SIGINT or SIGTERM.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CapabilityCatalog,
  CapabilityConnections,
  CapabilityService,
  CapabilityStore,
  needsAuthorizationNotice,
  OAUTH_CALLBACK_PATH,
} from '@emanator/capabilities/server';
import { TelegramChannel } from '@emanator/channels/server';
import {
  CONVERSATION_COMMANDS,
  ConversationService,
  ConversationStore,
  type PrepareTurn,
} from '@emanator/conversations/server';
import { UsageTracker } from '@emanator/engine';
import { ClaudeAgentSdkEngine } from '@emanator/engine/server';
import {
  agentFaculties,
  type MemoryConfirmation,
  taintsTurn,
  turnAbilities,
} from '@emanator/faculties/server';
import { memoryPrompt, TurnTrust } from '@emanator/memory';
import { MemoryService } from '@emanator/memory/server';
import { PersonaStore } from '@emanator/personas/server';
import { ApprovalService, PolicyService, PolicyStore } from '@emanator/policies/server';
import { RoutineRunner, RoutineService, RoutineStore } from '@emanator/routines/server';
import { consoleLogger, openDatabase } from '@emanator/shared/server';
import { loadConfig } from './config.ts';
import {
  CAPABILITIES_PAGE,
  CAPABILITIES_PREFIX,
  createDashboardServer,
} from './dashboard-server.ts';
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
  const policies = new PolicyService({
    store: policyStore,
    approvals,
    groups: () => [...faculties, ...capabilities.groups()],
    logger: consoleLogger('policies'),
  });

  const capabilityStore = new CapabilityStore(db, config.secrets, consoleLogger('capabilities'));
  await capabilityStore.init();
  const catalog = new CapabilityCatalog();
  const capabilityConnections = new CapabilityConnections({
    store: capabilityStore,
    redirectUrl: `${config.dashboardUrl}${CAPABILITIES_PREFIX}${OAUTH_CALLBACK_PATH}`,
    notifyNeedsAuthorization: async (capability) => {
      const page = `${config.dashboardUrl}${CAPABILITIES_PAGE}`;
      await channel.send(undefined, { markdown: needsAuthorizationNotice(capability, page) });
    },
    logger: consoleLogger('capabilities'),
    signInHostsOf: ({ catalogId }) =>
      catalogId === undefined ? undefined : catalog.offer(catalogId)?.entry.signInHosts,
  });
  const capabilities = new CapabilityService({
    store: capabilityStore,
    connections: capabilityConnections,
    forgetPolicies: (tools) => policies.forget(tools),
    catalog,
  });
  await capabilities.init();

  // Outside the working folder, so the Engine's file Tools can't write it (ADR 0009).
  const memory = new MemoryService({
    dir: join(config.dataDir, 'memory'),
    timeZone: config.timeZone,
    logger: consoleLogger('memory'),
  });
  await memory.init();

  // Built for every turn, so a Policy or a Capability saved in the dashboard applies from the
  // next one, and Memory knows whether the turn still speaks for the Owner.
  const prepareTurn: PrepareTurn = async (context) => {
    const trust = new TurnTrust(context.origin, context.tainted);
    const confirm = async ({ message, input }: MemoryConfirmation) =>
      (await approvals.request({
        tool: 'memory',
        input,
        message,
        threadId: await context.thread(),
        // The tool waits for the answer, so the turn can't end before it; expiry still applies.
        signal: new AbortController().signal,
      })) === 'approved';
    const turnFaculties = agentFaculties({ conversations, memory }, { trust, confirm });
    const { tools, engineTools } = turnAbilities(
      await policies.usable(turnFaculties.flatMap(({ tools }) => tools)),
    );
    return {
      tools: [...tools, ...(await policies.usable(capabilities.turnTools()))],
      engineTools,
      decidePermission: policies.decider(context),
      onToolUse: (tool) => {
        if (taintsTurn(tool)) trust.taint();
      },
    };
  };

  const usage = new UsageTracker();
  const agentPrompt = async () => {
    const persona = await personas.get();
    return systemPrompt(new Date(), config.timeZone, persona, memoryPrompt(await memory.pages()));
  };
  const conversations = new ConversationService({
    channel,
    engine,
    store,
    usage,
    prepareTurn,
    systemPrompt: agentPrompt,
    defaultModel: config.defaultModel,
    timeZone: config.timeZone,
    logger: consoleLogger('conversations'),
  });
  // After the service, which the conversations Faculty needs; turns read it only later.
  const faculties = agentFaculties({ conversations, memory });

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
      prepareTurn,
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
    capabilities,
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
    await capabilityConnections.close();
    await db.end();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
