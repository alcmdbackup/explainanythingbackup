// Server-only: SHA-256 hashing + accepted-hash registry for the 4-arm experiment. Split from
// experimentArms.ts so the create-session form (a client component) can import the prompt
// strings without pulling node:crypto into the browser bundle. The analysis script + tests
// import from here; the UI form imports only from experimentArms.ts. NOT added to the
// public barrel (`./index.ts`) for the same reason.
//
// Why a hash registry per arm (not a single hash): a typo fix in any of these strings should
// APPEND a new entry to ACCEPTED_HASHES[arm], not replace the existing entry — so historical
// arm runs (whose persisted holistic_prompt_override hashes the OLD string) still verify.
// Old entries stay valid forever; only the FIRST entry is the "current canonical" hash.

import { createHash } from 'node:crypto';
import {
  ARM_A_CANONICAL_RUBRIC_BLOCK,
  EXPERIMENT_ARMS,
  type ArmKey,
} from './experimentArms';

/** SHA-256 hex digest. Pure node:crypto so the analysis script + tests share one
 *  implementation. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Per-arm hash registry. Entry [0] is the current canonical hash; later entries are kept so
 *  historical arm runs (whose persisted override hashes an older revision of the prompt)
 *  still verify cleanly. APPEND on a typo fix; NEVER remove. */
export const ACCEPTED_HASHES: Record<ArmKey, string[]> = {
  A: [sha256Hex(ARM_A_CANONICAL_RUBRIC_BLOCK)],
  B: [sha256Hex(EXPERIMENT_ARMS.B.prompt!)],
  C: [sha256Hex(EXPERIMENT_ARMS.C.prompt!)],
  D: [sha256Hex(EXPERIMENT_ARMS.D.prompt!)],
};

/** Verify a persisted `holistic_prompt_override` against an arm's accepted-hash registry.
 *  Returns true if the override (or the canonical Arm A block when override is null) matches
 *  ANY entry in `ACCEPTED_HASHES[arm]`. */
export function verifyArmHash(arm: ArmKey, override: string | null): boolean {
  const subject = override ?? ARM_A_CANONICAL_RUBRIC_BLOCK;
  const hash = sha256Hex(subject);
  return ACCEPTED_HASHES[arm].includes(hash);
}
