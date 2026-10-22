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
  isModelChoice,
  isSuggestedReply,
  type PrepareTurn,
} from '@emanator/conversations/server';
import { DreamService, DreamStore } from '@emanator/dreams/server';
import { type JsonSchemaToolDefinition, UsageTracker } from '@emanator/engine';
import { ClaudeAgentSdkEngine, ModelSettings } from '@emanator/engine/server';
import {
  agentFaculties,
  type MemoryConfirmation,
  MemoryReview,
  type NotedFact,
  taintsTurn,
  turnAbilities,
} from '@emanator/faculties/server';
import { memoryPrompt, TurnTrust } from '@emanator/memory';
import { MemoryService } from '@emanator/memory/server';
import { PersonaStore } from '@emanator/personas/server';
import { ApprovalService, PolicyService, PolicyStore } from '@emanator/policies/server';
import { RoutineRunner, RoutineService, RoutineStore } from '@emanator/routines/server';
import { consoleLogger, openDatabase } from '@emanator/shared/server';
import { TimeZoneSettings } from '@emanator/timezone/server';
import { loadConfig } from './config.ts';
import {
  CAPABILITIES_PAGE,
  CAPABILITIES_PREFIX,
  createDashboardServer,
} from './dashboard-server.ts';
import {
  abilityLines,
  routineLines,
  type SelfSource,
  selfReport,
  setupLines,
} from './self-report.ts';
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

  const timeZones = new TimeZoneSettings(db, config.initialTimeZone, consoleLogger('timezone'));
  await timeZones.init();
  const timeZone = () => timeZones.timeZone();
  const models = new ModelSettings(db, config.initialModel);
  await models.init();
  const defaultModel = () => models.defaultModel();
  const engine = new ClaudeAgentSdkEngine({
    credentials: config.engineCredentials,
    configDir: join(config.dataDir, 'claude'),
    // Every turn names its model; this only covers a caller that doesn't.
    defaultModel: config.initialModel,
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
    timeZone,
    logger: consoleLogger('memory'),
  });
  await memory.init();
  const memoryReview = new MemoryReview({ channel, memory, logger: consoleLogger('memory') });
  const dreamStore = new DreamStore(db);
  await dreamStore.init();
  const dreams = new DreamService({
    store: dreamStore,
    engine,
    memory,
    // Conversations keep the Dream's Journal, so they come after it; the Dream asks only later.
    conversations: {
      dreamTopic: (title) => conversations.dreamTopic(title),
      deliver: (topic, markdown, actions) => conversations.deliver(topic, markdown, actions),
    },
    channel,
    defaultModel,
    timeZone,
    logger: consoleLogger('dream'),
  });
  await dreams.init();
  /** What a Capability returns tells the Dream about the Owner's world, so it is kept. */
  const journaled = (tool: JsonSchemaToolDefinition, place: string): JsonSchemaToolDefinition => ({
    ...tool,
    run: async (input) => {
      const output = await tool.run(input);
      if (!output.isError)
        dreams.record({ place, author: 'tool', tool: tool.name, text: output.text });
      return output;
    },
  });

  // Built for every turn, so a Policy or a Capability saved in the dashboard applies from the
  // next one, and Memory knows whether the turn still speaks for the Owner.
  const prepareTurn: PrepareTurn = async (context) => {
    const trust = new TurnTrust(context.origin, context.tainted, context.onTaint);
    const noted: NotedFact[] = [];
    const confirm = async ({ message, input }: MemoryConfirmation) =>
      (await approvals.request({
        tool: 'memory',
        input,
        message,
        threadId: await context.thread(),
        // The tool waits for the answer, so the turn can't end before it; expiry still applies.
        signal: new AbortController().signal,
      })) === 'approved';
    const turnFaculties = agentFaculties(
      { conversations, memory, routines, timeZone },
      {
        trust,
        ...(context.conversationId && { conversationId: context.conversationId }),
        ...(context.reminderRun && { reminderRun: true }),
        confirm,
        noted: (fact) => noted.push(fact),
        ...(context.suggestReplies && { suggestReplies: context.suggestReplies }),
      },
    );
    const { tools, engineTools } = turnAbilities(
      await policies.usable(turnFaculties.flatMap(({ tools }) => tools)),
    );
    return {
      tools: [
        ...tools,
        ...(await policies.usable(capabilities.turnTools())).map((tool) =>
          journaled(tool, context.place),
        ),
      ],
      engineTools,
      decidePermission: policies.decider({
        thread: context.thread,
        ...(context.onWaiting && { onWaiting: context.onWaiting }),
        tainted: () => trust.tainted,
      }),
      onToolUse: (tool) => {
        if (taintsTurn(tool)) trust.taint();
      },
      epilogue: () => memoryReview.message(noted),
    };
  };

  const usage = new UsageTracker();
  // "Chi sei": each source reads a registry or a setting, so new Faculties, Capabilities and
  // catalog entries show up on their own. Only a new kind of state adds a source here.
  const selfSources: SelfSource[] = [
    () =>
      setupLines({
        model: models.defaultModel(),
        timeZone: timeZone(),
        dream: dreams.currentSettings(),
      }),
    async () =>
      abilityLines(await policies.list(), await capabilities.list(), await capabilities.catalog()),
    async () => routineLines(await routines.list()),
  ];
  const agentPrompt = async () => {
    const [persona, self, pages] = await Promise.all([
      personas.get(),
      selfReport(selfSources, config.dashboardUrl, logger),
      memory.pages(),
    ]);
    return systemPrompt(new Date(), timeZone(), persona, { self, memory: memoryPrompt(pages) });
  };
  const conversations = new ConversationService({
    channel,
    engine,
    store,
    usage,
    prepareTurn,
    journal: (entry) => dreams.record(entry),
    systemPrompt: agentPrompt,
    defaultModel,
    timeZone,
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
      prepareTurn,
      systemPrompt: agentPrompt,
      defaultModel,
      timeZone,
      logger: routineLogger,
    }),
    conversations,
    timeZone,
    logger: routineLogger,
  });

  // After the services the Faculties need; Policies and turns read it only later.
  const faculties = agentFaculties({
    conversations,
    memory,
    routines,
    timeZone,
  });

  // Recurring times are wall-clock times: they move with the Owner's zone.
  timeZones.onTimeZoneChange(() => {
    routines.reschedule();
    dreams.reschedule();
  });

  const dashboard = await createDashboardServer({
    personas,
    timeZones,
    models,
    routines,
    policies,
    capabilities,
    memory,
    dreams,
    logger: consoleLogger('dashboard'),
  });
  try {
    await dashboard.listen({ host: config.httpHost, port: config.httpPort });
    await channel.setCommands(CONVERSATION_COMMANDS);
    await channel.start((event) => {
      // Presses answer turns that may hold their Conversation's queue: they skip it. Only a
      // suggested reply is a message of the Owner's, so only it goes through the queue.
      if (event.type !== 'action' || isSuggestedReply(event)) conversations.handle(event);
      else if (isModelChoice(event)) void conversations.chooseModel(event);
      else if (memoryReview.handles(event)) void memoryReview.answer(event);
      else if (dreams.handles(event)) void dreams.answer(event);
      else void approvals.answer(event);
    });
    await routines.start();
    logger.info('Emanator is running', {
      model: models.defaultModel(),
      timeZone: timeZone(),
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
    // A Dream cut short is marked failed at the next start, and its Journal kept.
    dreams.stop();
    await channel.stop();
    await conversations.idle();
    await capabilityConnections.close();
    await db.end();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
