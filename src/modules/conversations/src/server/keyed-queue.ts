/**
 * Runs tasks one at a time per key and in parallel across keys.
 * In memory only: a crash loses whatever was still queued.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(task);
    const tail: Promise<void> = result
      .catch(() => {})
      .finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    this.tails.set(key, tail);
    return result;
  }

  /** Resolves once every queued task has finished. */
  async idle(): Promise<void> {
    while (this.tails.size > 0) await Promise.all(this.tails.values());
  }
}
