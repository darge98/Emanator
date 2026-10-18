import type { Engine, TurnRequest } from './domain/engine.ts';
import type { EngineEvent } from './domain/events.ts';

/** Decides what a fake turn emits; may wait, to simulate a slow model. */
export type ScriptedTurn = (request: TurnRequest) => EngineEvent[] | Promise<EngineEvent[]>;

/** Engine double for tests: records every request and plays scripted turns in order. */
export class FakeEngine implements Engine {
  readonly id = 'fake';
  readonly requests: TurnRequest[] = [];
  private readonly scripted: ScriptedTurn[] = [];

  constructor(private readonly fallback: ScriptedTurn = replyWith('ok')) {}

  /** The next turns play these scripts, then the fallback. */
  script(...turns: ScriptedTurn[]): this {
    this.scripted.push(...turns);
    return this;
  }

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEvent> {
    this.requests.push(request);
    const turn = this.scripted.shift() ?? this.fallback;
    yield* await turn(request);
  }
}

/** A turn that answers `text`, resuming the request's session or starting `newSessionId`. */
export function replyWith(text: string, newSessionId = 'session-1'): ScriptedTurn {
  return (request) => {
    const session = request.session ?? { engine: 'fake', id: newSessionId };
    return [
      {
        type: 'turn.started',
        session,
        model: request.model ?? 'fake',
        tools: [],
        credentials: 'subscription',
      },
      { type: 'text', text },
      { type: 'turn.completed', session, text, costUsd: 0, durationMs: 1 },
    ];
  };
}
