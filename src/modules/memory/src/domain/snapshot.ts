import type { PageKind } from './kinds.ts';
import type { Page } from './page.ts';

/** One line of `log.md`: when, and what changed. */
export interface MemoryChange {
  /** `YYYY-MM-DD HH:MM`, in the Harness's time zone. */
  at: string;
  change: string;
}

/** Everything the dashboard shows of Memory, read in one go: a vault stays small. */
export interface MemorySnapshot {
  pages: Page[];
  kinds: PageKind[];
  /** The latest first. */
  changes: MemoryChange[];
}
