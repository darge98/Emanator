/** Who started a turn: only one the Owner started can confirm Facts (ADR 0009). */
export type TurnOrigin = 'owner' | 'routine';

/**
 * How far one turn can be trusted to speak for the Owner. A turn the Owner started confirms
 * what it remembers until outside content reaches it; from then on it only infers.
 */
export class TurnTrust {
  private outside: boolean;

  constructor(
    readonly origin: TurnOrigin,
    /** True when the turn starts with outside content, e.g. a Routine's handoff. */
    tainted = false,
  ) {
    this.outside = tainted || origin === 'routine';
  }

  get tainted(): boolean {
    return this.outside;
  }

  taint(): void {
    this.outside = true;
  }

  /** The trust of what this turn writes now. */
  get writes(): 'confirmed' | 'inferred' {
    return this.outside ? 'inferred' : 'confirmed';
  }
}
