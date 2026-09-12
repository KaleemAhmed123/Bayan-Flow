/**
 * A short, sortable, collision-resistant id with a readable prefix.
 *
 * Seven copies of this one line existed — in main, the recorder, the
 * transcription service, both providers, the history store and the error
 * normaliser — five byte-identical and two differing only in their separator.
 * Never a correctness bug, just the same line maintained seven times.
 *
 * Deliberately dependency-free. `errors.ts` and `history-store.ts` both use it,
 * and `errors.ts` is unit-tested without Electron loaded at all, so this module
 * must never reach for anything.
 */
export function createPrefixedId(prefix: string, separator = "-"): string {
  return `${prefix}${separator}${Date.now().toString(36)}${separator}${Math.random().toString(36).slice(2, 8)}`;
}
