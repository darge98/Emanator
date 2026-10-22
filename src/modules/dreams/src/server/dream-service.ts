import type { Channel, InboundAction, MessageAction } from '@emanator/channels';
import type { ConversationService } from '@emanator/conversations/server';
import { type Engine, isModel, MODELS } from '@emanator/engine';
import { memoryFaculty, turnAbilities } from '@emanator/faculties/server';
import { OWNER_KIND, OWNER_PAGE, sameTitle, TurnTrust } from '@emanator/memory';
import { MemoryError, type MemoryService } from '@emanator/memory/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { Cron } from 'croner';
import {
  type AskedFact,
  DEFAULT_DREAM_SETTINGS,
  type DreamRun,
  type DreamSettings,
  type DreamView,
  validDreamTime,
} from '../domain/dream.ts';
import type { JournalEntry } from '../domain/journal.ts';
import { type Proposal, REJECTED_DAYS } from '../domain/proposal.ts';
import { dreamPrompt, journalText } from './dream-prompt.ts';
import type { DreamStore, StoredEntry } from './dream-store.ts';
import { type DreamNotes, noteTool } from './dream-tools.ts';
import * as say from './messages.ts';
import { type Proposed, proposeTool, retrospectivePrompt } from './retrospective.ts';

export interface DreamServiceDeps {
  store: DreamStore;
  engine: Engine;
  memory: MemoryService;
  /** Where the Dream asks: its own topic. */
  conversations: Pick<ConversationService, 'dreamTopic' | 'deliver'>;
  /** Updates the buttons under a question once answered. */
  channel: Pick<Channel, 'setActions'>;
  /** Used unless the Owner picked the Dream's own; read at every Dream. */
  defaultModel: () => string;
  /** IANA zone the Dream's time is read in. */
  timeZone: () => string;
  /**
   * For the Retrospective: what went wrong since `since` (refused Approvals, failed Runs) and
   * what the Agent is now. Without it, the Retrospective reads only the Journal.
   */
  retrospectiveContext?: (since: Date) => Promise<string>;
  logger: Logger;
}

/** Settings the dashboard sent that can't be saved. */
export class DreamSettingsError extends Error {
  override readonly name = 'DreamSettingsError';
}

/** No Proposal has this id. */
export class ProposalNotFoundError extends Error {
  override readonly name = 'ProposalNotFoundError';
  constructor() {
    super('There is no such proposal.');
  }
}

/** A Dream is running already. */
export class DreamBusyError extends Error {
  override readonly name = 'DreamBusyError';
  constructor() {
    super('A Dream is running already.');
  }
}

/** The longest text of one Journal entry; a long mail is cut. */
const ENTRY_LENGTH = 4_000;
/** How long the Journal waits for a Dream that doesn't come, e.g. while one keeps failing. */
const JOURNAL_DAYS = 7;
const PREFIX = 'dq:';
/** The buttons of the Retrospective's question. */
const PROPOSAL_PREFIX = 'pp:';
const BY_TELEGRAM = 'da Telegram';

/**
 * The Dream (ADR 0009): every night it reads the Journal, writes what it infers to Memory and
 * asks the Owner about what matters. It keeps the Journal too, only while it is on.
 */
export class DreamService {
  private settings: DreamSettings | undefined;
  private job: Cron | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly deps: DreamServiceDeps) {}

  async init(): Promise<void> {
    this.settings = await this.deps.store.settings();
    this.schedule();
  }

  /** Sets the next Dream again, e.g. once the time zone changed: its time moves with it. */
  reschedule(): void {
    this.schedule();
  }

  stop(): void {
    this.job?.stop();
    this.job = undefined;
  }

  /** The settings in force, without a query; the defaults before `init`. */
  currentSettings(): DreamSettings {
    return this.settings ?? DEFAULT_DREAM_SETTINGS;
  }

  /** Resolves when the Dream running now, if any, has finished. */
  async idle(): Promise<void> {
    await this.running;
  }

  async view(): Promise<DreamView> {
    const { store } = this.deps;
    const [settings, lastRun, waiting, proposals] = await Promise.all([
      store.settings(),
      store.lastRun(),
      store.waiting(),
      store.proposals(),
    ]);
    const next = this.job?.nextRun();
    return {
      settings,
      ...(lastRun && { lastRun }),
      ...(next && { nextAt: next.toISOString() }),
      waiting,
      proposals,
    };
  }

  async saveSettings(input: unknown): Promise<DreamView> {
    const settings = parseSettings(input);
    await this.deps.store.saveSettings(settings);
    this.settings = settings;
    // Off means nothing is kept: what was waiting goes too.
    if (!settings.enabled) await this.deps.store.sweepJournal();
    this.schedule();
    return this.view();
  }

  /**
   * Keeps something said or read for the next Dream. Never throws: losing an entry costs
   * the Dream a little, failing the turn would cost the Owner.
   */
  record(entry: Omit<JournalEntry, 'at'>): void {
    if (!this.settings?.enabled || !entry.text.trim()) return;
    const text =
      entry.text.length > ENTRY_LENGTH ? `${entry.text.slice(0, ENTRY_LENGTH)}…` : entry.text;
    this.deps.store.record({ ...entry, text, at: new Date() }).catch((error: unknown) => {
      this.deps.logger.error('Could not keep a Journal entry', { error: errorMessage(error) });
    });
  }

  /**
   * Starts a Dream now, from the dashboard. It runs in the background; this resolves once its
   * Run is recorded, so the dashboard sees it running, or at once when there is nothing to read.
   */
  async dreamNow(): Promise<void> {
    if (this.running) throw new DreamBusyError();
    let resolve = () => {};
    const started = new Promise<void>((done) => {
      resolve = done;
    });
    this.running = this.dream(resolve).finally(() => {
      resolve();
      this.running = undefined;
    });
    await started;
  }

  handles(press: InboundAction): boolean {
    return press.actionId.startsWith(PREFIX) || press.actionId.startsWith(PROPOSAL_PREFIX);
  }

  /**
   * The Owner answers a morning question: about Facts, one or all of them, or about one
   * Proposal. Never rejects.
   */
  async answer(press: InboundAction): Promise<void> {
    try {
      if (press.actionId.startsWith(PROPOSAL_PREFIX)) await this.answerProposal(press);
      else await this.apply(press);
    } catch (error) {
      this.deps.logger.error('Could not answer the Dream question', { error: errorMessage(error) });
    }
  }

  /**
   * Accepts or rejects a Proposal, from Telegram or the dashboard; once only. An accepted
   * instruction becomes a confirmed one in Memory: the Owner's yes covers its exact text.
   * Undefined when it was answered already; throws ProposalNotFoundError when unknown.
   */
  async decideProposal(
    id: string,
    status: 'accepted' | 'rejected',
    by = 'dalla dashboard',
  ): Promise<Proposal | undefined> {
    const { store, memory } = this.deps;
    if (!(await store.proposal(id))) throw new ProposalNotFoundError();
    const decided = await store.decideProposal(id, status);
    if (!decided || status !== 'accepted' || decided.kind !== 'instruction') return decided;
    try {
      // Already a rule of the Owner's, e.g. accepted from another Proposal: once is enough.
      const owner = await memory.page(OWNER_PAGE);
      if (owner?.facts.some(({ text }) => sameTitle(text, decided.text))) return decided;
      await memory.remember({
        page: OWNER_PAGE,
        kind: OWNER_KIND,
        mayAddKind: false,
        fact: decided.text,
        factKind: 'instruction',
        trust: 'confirmed',
        source: say.PROPOSAL_SOURCE,
        by,
      });
    } catch (error) {
      // Not in Memory, so not accepted: the Owner can try again.
      await store.reopenProposal(id);
      throw error;
    }
    return decided;
  }

  private async answerProposal(press: InboundAction): Promise<void> {
    const [id = '', choice] = press.actionId.slice(PROPOSAL_PREFIX.length).split(':');
    if (!id || (choice !== 'y' && choice !== 'n')) return;
    const proposal = await this.deps.store.proposal(id);
    if (!proposal) return this.setActions(press, [{ id: PROPOSAL_PREFIX, label: say.EXPIRED }]);
    try {
      await this.decideProposal(id, choice === 'y' ? 'accepted' : 'rejected', BY_TELEGRAM);
    } finally {
      // From the store, so a failed acceptance shows its buttons again.
      await this.setActions(
        press,
        proposalActions(await this.deps.store.proposalsOfRun(proposal.runId)),
      );
    }
  }

  private async apply(press: InboundAction): Promise<void> {
    const [runId = '', which, choice] = press.actionId.slice(PREFIX.length).split(':');
    if (!runId) return;
    const run = await this.deps.store.run(runId);
    if (!run) return this.setActions(press, [{ id: PREFIX, label: say.EXPIRED }]);
    const indexes = which === 'all' ? run.asked.map((_, index) => index) : [Number(which)];
    const answer = which === 'all' || choice === 'y' ? 'confirmed' : 'forgotten';
    const result = await this.deps.store.answer(runId, indexes, answer);
    if (!result) return;
    for (const index of indexes) {
      const fact = result.before.asked[index];
      if (!fact || fact.answer) continue;
      try {
        if (answer === 'confirmed') await this.deps.memory.confirm(fact.page, fact.id, BY_TELEGRAM);
        else await this.deps.memory.forget(fact.page, fact.id, BY_TELEGRAM);
      } catch (error) {
        // Gone since, e.g. forgotten from the dashboard: nothing left to do.
        if (!(error instanceof MemoryError)) throw error;
      }
    }
    await this.setActions(press, questionActions(result.after));
  }

  private schedule(): void {
    this.stop();
    if (!this.settings?.enabled) return;
    const [hour, minute] = this.settings.time.split(':').map(Number);
    this.job = new Cron(`${minute} ${hour} * * *`, { timezone: this.deps.timeZone() }, () => {
      void this.nightly();
    });
  }

  private async nightly(): Promise<void> {
    try {
      await this.deps.store.sweepJournal(new Date(Date.now() - JOURNAL_DAYS * 86_400_000));
      await this.dreamNow();
    } catch (error) {
      // Busy: the Dream started from the dashboard reads the same Journal.
      if (!(error instanceof DreamBusyError)) {
        this.deps.logger.error('Could not start the Dream', { error: errorMessage(error) });
      }
    }
  }

  /** Never rejects: the outcome ends up in the Dream's Run, and failures in the log too. */
  private async dream(started: () => void): Promise<void> {
    const { store, logger } = this.deps;
    let run: DreamRun;
    try {
      // Nothing to read: no Run, so the last one shown stays the last that read something.
      if ((await store.waiting()) === 0) return;
      run = await store.startRun();
    } catch (error) {
      logger.error('Could not start the Dream', { error: errorMessage(error) });
      return;
    }
    started();
    const notes: DreamNotes = { noted: 0, asked: [] };
    try {
      const entries = await store.journal();
      const error = await this.read(entries, notes);
      // The Retrospective reads the same Journal, so it goes only after both.
      const proposals = error ? [] : await this.retrospect(run.id, entries);
      const last = entries.at(-1);
      // A failed Dream keeps the Journal for the next one; what it wrote stays.
      if (!error && last) await store.forgetJournal(last.id);
      await store.finishRun(run.id, {
        status: error ? 'failed' : 'done',
        noted: notes.noted,
        asked: notes.asked,
        ...(error && { error }),
      });
      // Each on its own: one that can't be sent doesn't keep the other from the Owner.
      if (!error && notes.asked.length) {
        await this.tryAsk(
          say.question(notes.asked, notes.noted),
          questionActions({ id: run.id, ...notes }),
        );
      }
      if (proposals.length) {
        await this.tryAsk(say.proposals(proposals), proposalActions(proposals));
      }
    } catch (error) {
      logger.error('The Dream failed', { error: errorMessage(error) });
      await store
        .finishRun(run.id, { status: 'failed', ...notes, error: errorMessage(error) })
        .catch(() => undefined);
    }
  }

  /** Reads the Journal into Memory; returns why it failed, if it did. */
  private async read(
    entries: readonly StoredEntry[],
    notes: DreamNotes,
  ): Promise<string | undefined> {
    const { engine, memory, timeZone } = this.deps;
    if (entries.length === 0) return undefined;
    // A Run's Memory Faculty: only recall.
    const { tools: recall } = turnAbilities(
      memoryFaculty(memory, { trust: new TurnTrust('routine'), confirm: async () => false }).tools,
    );
    let failure: string | undefined;
    for await (const event of engine.runTurn({
      prompt: journalText(entries, timeZone()),
      systemPrompt: dreamPrompt(await memory.pages(), await memory.kinds()),
      model: this.model(),
      tools: [...recall, noteTool(memory, notes)],
      engineTools: [],
      // Its Tools are fixed and harmless; nothing else is given.
      decidePermission: async () => ({ behavior: 'allow' }),
    })) {
      if (event.type === 'turn.failed') failure = `${event.reason}: ${event.message}`;
    }
    return failure;
  }

  /**
   * The Retrospective: a turn of its own over the same Journal, which only proposes. It never
   * fails the Dream: without it, the night simply brings no Proposals.
   */
  private async retrospect(runId: string, entries: readonly StoredEntry[]): Promise<Proposal[]> {
    const { store, engine, timeZone, logger } = this.deps;
    const first = entries[0];
    if (!first) return [];
    try {
      const [context, standing, pages] = await Promise.all([
        this.deps.retrospectiveContext?.(first.at) ?? '',
        store.standingProposals(new Date(Date.now() - REJECTED_DAYS * 86_400_000)),
        this.deps.memory.pages(),
      ]);
      const rules = pages.flatMap(({ facts }) =>
        facts
          .filter(({ kind, trust }) => trust === 'confirmed' && kind !== 'fact')
          .map(({ text }) => text),
      );
      const found: Proposed[] = [];
      for await (const event of engine.runTurn({
        prompt: [context, journalText(entries, timeZone())].filter(Boolean).join('\n\n'),
        systemPrompt: retrospectivePrompt(standing, rules),
        model: this.model(),
        tools: [proposeTool(found)],
        engineTools: [],
        // It can only propose; the Owner decides.
        decidePermission: async () => ({ behavior: 'allow' }),
      })) {
        if (event.type === 'turn.failed') {
          logger.warn('The Retrospective failed', { reason: event.reason, error: event.message });
          return [];
        }
      }
      return await store.addProposals(runId, found);
    } catch (error) {
      logger.error('The Retrospective failed', { error: errorMessage(error) });
      return [];
    }
  }

  /** Asks in the Dream's topic; a failure is only logged, the answers wait in the dashboard. */
  private async tryAsk(markdown: string, actions: readonly MessageAction[]): Promise<void> {
    try {
      await this.ask(markdown, actions);
    } catch (error) {
      this.deps.logger.error('Could not ask in the Dream topic', { error: errorMessage(error) });
    }
  }

  private model(): string {
    return this.settings?.model ?? this.deps.defaultModel();
  }

  /**
   * In the Dream's own topic, handed to its next turn, so the Owner can answer in words too.
   * A topic found deleted is replaced once.
   */
  private async ask(markdown: string, actions: readonly MessageAction[]): Promise<void> {
    const { conversations } = this.deps;
    for (let attempt = 0; attempt < 2; attempt++) {
      const topic = await conversations.dreamTopic(say.TOPIC_TITLE);
      if (await conversations.deliver(topic, markdown, actions)) return;
    }
    throw new Error('The Dream topic was gone twice in a row.');
  }

  private async setActions(press: InboundAction, actions: MessageAction[]): Promise<void> {
    try {
      await this.deps.channel.setActions(press.messageId, actions);
    } catch (error) {
      this.deps.logger.warn('Could not update the Dream question', { error: errorMessage(error) });
    }
  }
}

/** One row per Fact, ✓ and ✕ until answered, then the answer; and ✓ Tutti while any is open. */
function questionActions({ id, asked }: Pick<DreamRun, 'id' | 'asked'>): MessageAction[] {
  const rows = asked.flatMap((fact: AskedFact, index): MessageAction[] => {
    const n = index + 1;
    if (fact.answer) {
      const label = fact.answer === 'confirmed' ? say.confirmed(n) : say.forgotten(n);
      return [{ id: PREFIX, label, row: index }];
    }
    return [
      { id: `${PREFIX}${id}:${index}:y`, label: say.yes(n), row: index },
      { id: `${PREFIX}${id}:${index}:n`, label: say.no(n), row: index },
    ];
  });
  const open = asked.some((fact) => !fact.answer);
  return open ? [...rows, { id: `${PREFIX}${id}:all`, label: say.ALL, row: asked.length }] : rows;
}

/** One row per Proposal: ✓ and ✕ until answered, then the answer. */
function proposalActions(proposals: readonly Proposal[]): MessageAction[] {
  return proposals.flatMap((proposal, index): MessageAction[] => {
    const n = index + 1;
    if (proposal.status !== 'open') {
      const label = proposal.status === 'accepted' ? say.accepted(n) : say.rejected(n);
      return [{ id: PROPOSAL_PREFIX, label, row: index }];
    }
    return [
      { id: `${PROPOSAL_PREFIX}${proposal.id}:y`, label: say.yes(n), row: index },
      { id: `${PROPOSAL_PREFIX}${proposal.id}:n`, label: say.no(n), row: index },
    ];
  });
}

function parseSettings(input: unknown): DreamSettings {
  const { enabled, time, model } = (input ?? {}) as Partial<Record<keyof DreamSettings, unknown>>;
  if (typeof enabled !== 'boolean') throw new DreamSettingsError('enabled must be true or false.');
  if (typeof time !== 'string' || !validDreamTime(time)) {
    throw new DreamSettingsError('time must be HH:MM, e.g. 07:00.');
  }
  if (model !== undefined && model !== null && !isModel(model)) {
    throw new DreamSettingsError(`model must be one of: ${MODELS.map(({ id }) => id).join(', ')}.`);
  }
  return { enabled, time, ...(isModel(model) && { model }) };
}
