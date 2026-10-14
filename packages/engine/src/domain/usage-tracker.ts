import type { UsageLimitChanged } from './events.ts';

/** Remembers the latest usage report from any turn, for status displays. In memory only. */
export class UsageTracker {
  private last: UsageLimitChanged | undefined;

  record(event: UsageLimitChanged): void {
    this.last = event;
  }

  latest(): UsageLimitChanged | undefined {
    return this.last;
  }
}
