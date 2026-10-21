import type { Channel, InboundAction, MessageAction } from '@emanator/channels';
import { type Engine, isModel, MODELS } from '@emanator/engine';
import { memoryFaculty, turnAbilities } from '@emanator/faculties/server';
import { TurnTrust } from '@emanator/memory';
import { MemoryError, type MemoryService } from '@emanator/memory/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { Cron } from 'croner';
import {
  type AskedFact,
  type DreamRun,
  type DreamSettings,
  type DreamView,
  validDreamTime,
} from '../domain/dream.ts';
import type { JournalEntry } from '../domain/journal.ts';
import { dreamPrompt, journalText } from './dream-prompt.ts';
import type { DreamStore } from './dream-store.ts';
import { type DreamNotes, noteTool } from './dream-tools.ts';
import * as say from './messages.ts';

export interface DreamServiceDeps {
  store: DreamStore;
  engine: Engine;
  memory: MemoryService;
  channel: Pick<Channel, 'send' | 'setActions'>;
  /** Used unless the Owner picked the Dream's own; read at every Dream. */
  defaultModel: () => string;
  /** IANA zone the Dream's time is read in. */
  timeZone: string;
  logger: Logger;
}

/** Settings the dashboard sent that can't be saved. */
export class DreamSettingsError extends Error {
  override readonly name = 'DreamSettingsError';
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

  stop(): void {
    this.job?.stop();
    this.job = undefined;
  }

  /** Resolves when the Dream running now, if any, has finished. */
  async idle(): Promise<void> {
    await this.running;
  }

  async view(): Promise<DreamView> {
    const { store } = this.deps;
    const [settings, lastRun, waiting] = await Promise.all([
      store.settings(),
      store.lastRun(),
      store.waiting(),
    ]);
    const next = this.job?.nextRun();
    return {
      settings,
      ...(lastRun && { lastRun }),
      ...(next && { nextAt: next.toISOString() }),
      waiting,
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
    return press.actionId.startsWith(PREFIX);
  }

  /** The Owner answers the morning question: one Fact, or all of them. Never rejects. */
  async answer(press: InboundAction): Promise<void> {
    try {
      await this.apply(press);
    } catch (error) {
      this.deps.logger.error('Could not answer the Dream question', { error: errorMessage(error) });
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
    this.job = new Cron(`${minute} ${hour} * * *`, { timezone: this.deps.timeZone }, () => {
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
      const error = await this.read(notes);
      await store.finishRun(run.id, {
        status: error ? 'failed' : 'done',
        noted: notes.noted,
        asked: notes.asked,
        ...(error && { error }),
      });
      if (!error && notes.asked.length) await this.ask(run.id, notes);
    } catch (error) {
      logger.error('The Dream failed', { error: errorMessage(error) });
      await store
        .finishRun(run.id, { status: 'failed', ...notes, error: errorMessage(error) })
        .catch(() => undefined);
    }
  }

  /** Reads the Journal into Memory and forgets it; returns why it failed, if it did. */
  private async read(notes: DreamNotes): Promise<string | undefined> {
    const { store, engine, memory, timeZone } = this.deps;
    const model = this.settings?.model ?? this.deps.defaultModel();
    const entries = await store.journal();
    const last = entries.at(-1);
    if (!last) return undefined;
    // A Run's Memory Faculty: only recall.
    const { tools: recall } = turnAbilities(
      memoryFaculty(memory, { trust: new TurnTrust('routine'), confirm: async () => false }).tools,
    );
    let failure: string | undefined;
    for await (const event of engine.runTurn({
      prompt: journalText(entries, timeZone),
      systemPrompt: dreamPrompt(await memory.pages(), await memory.kinds()),
      model,
      tools: [...recall, noteTool(memory, notes)],
      engineTools: [],
      // Its Tools are fixed and harmless; nothing else is given.
      decidePermission: async () => ({ behavior: 'allow' }),
    })) {
      if (event.type === 'turn.failed') failure = `${event.reason}: ${event.message}`;
    }
    // A failed Dream keeps the Journal for the next one; what it wrote stays.
    if (!failure) await store.forgetJournal(last.id);
    return failure;
  }

  /** In General, the Owner's own thread. */
  private async ask(id: string, { noted, asked }: DreamNotes): Promise<void> {
    await this.deps.channel.send(undefined, {
      markdown: say.question(asked, noted),
      actions: questionActions({ id, asked }),
    });
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
