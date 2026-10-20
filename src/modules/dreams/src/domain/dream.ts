/** What the Owner sets for the Dream in the dashboard. */
export interface DreamSettings {
  enabled: boolean;
  /** When it runs every night, `HH:MM` in the Harness's time zone. */
  time: string;
}

export const DEFAULT_DREAM_SETTINGS: DreamSettings = { enabled: true, time: '07:00' };

export function validDreamTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export type DreamStatus = 'running' | 'done' | 'failed';

/** An inferred Fact the Dream asked the Owner about, and their answer once given. */
export interface AskedFact {
  page: string;
  id: string;
  text: string;
  source: string;
  answer?: 'confirmed' | 'forgotten';
}

/** One night's pass over the Journal. */
export interface DreamRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: DreamStatus;
  /** How many inferred Facts it wrote. */
  noted: number;
  asked: AskedFact[];
  error?: string;
}

/** What the dashboard shows of the Dream. */
export interface DreamView {
  settings: DreamSettings;
  lastRun?: DreamRun;
  /** ISO time of the next Dream; absent while it is off. */
  nextAt?: string;
  /** Journal entries waiting for the next Dream. */
  waiting: number;
}
