// Pure id allocator for Prompt Editor config cards. Extracted from page.tsx so it is
// unit-testable and StrictMode-safe: the previous `nextId.current++` lived INSIDE a
// setState updater, which React StrictMode double-invokes in dev, so labels skipped
// numbers (config 1, 3, 5…). Deriving the next id purely from the current list fixes it.

/** Next config id = max existing id + 1 (1 when empty). Pure — safe to call inside a
 *  setState updater. */
export function nextConfigId(configs: ReadonlyArray<{ id: number }>): number {
  return configs.length === 0 ? 1 : Math.max(...configs.map((c) => c.id)) + 1;
}
