/** The text to log or show for anything thrown: an Error's message, or the value as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
