/**
 * Opaque pointer to an Engine-owned session (ADR 0006). The Harness stores it
 * and hands it back to resume; only the Engine named in `engine` understands `id`.
 */
export interface SessionRef {
  engine: string;
  id: string;
}
