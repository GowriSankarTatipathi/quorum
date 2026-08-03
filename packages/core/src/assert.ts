/**
 * Exhaustiveness helper. Placing this in the `default` branch of a switch turns a
 * newly-added union member into a compile error rather than a silent fallthrough.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Narrowing assertion with a typed error message. Used at trust boundaries. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant violation: ${message}`);
}
