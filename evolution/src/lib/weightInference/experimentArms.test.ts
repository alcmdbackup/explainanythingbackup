// Unit tests for the 4-arm experiment prompt constants + hash registry.

import { buildComparisonPrompt } from '@evolution/lib/shared/computeRatings';
import { ARM_A_CANONICAL_RUBRIC_BLOCK, EXPERIMENT_ARMS, type ArmKey } from './experimentArms';
import { ACCEPTED_HASHES, sha256Hex, verifyArmHash } from './experimentArmsHashing';
import { evolutionWiSessionInsertSchema, WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS } from '@evolution/lib/schemas';

const NON_NULL_ARMS: ArmKey[] = ['B', 'C', 'D'];
const ALL_ARMS: ArmKey[] = ['A', 'B', 'C', 'D'];

describe('experimentArms — registry shape', () => {
  it('exports an entry for each arm with the expected label + description shape', () => {
    for (const arm of ALL_ARMS) {
      expect(EXPERIMENT_ARMS[arm].label).toMatch(/^Arm [A-D] —/);
      expect(typeof EXPERIMENT_ARMS[arm].description).toBe('string');
    }
  });

  it('Arm A is the only null-prompt arm (= use the hardcoded default)', () => {
    expect(EXPERIMENT_ARMS.A.prompt).toBeNull();
    for (const arm of NON_NULL_ARMS) {
      expect(typeof EXPERIMENT_ARMS[arm].prompt).toBe('string');
      expect(EXPERIMENT_ARMS[arm].prompt!.length).toBeGreaterThan(0);
    }
  });
});

describe('experimentArms — DB CHECK constraint compliance', () => {
  it('every non-null arm prompt fits the 8000-char column cap (with headroom)', () => {
    for (const arm of NON_NULL_ARMS) {
      expect(EXPERIMENT_ARMS[arm].prompt!.length).toBeLessThanOrEqual(8000);
    }
  });
});

describe('experimentArms — Zod deny-list compliance', () => {
  it('every non-null arm prompt is clean of reserved markers', () => {
    for (const arm of NON_NULL_ARMS) {
      const prompt = EXPERIMENT_ARMS[arm].prompt!;
      for (const marker of WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS) {
        expect(prompt.includes(marker)).toBe(false);
      }
    }
  });

  it('every canonical arm prompt is accepted by evolutionWiSessionInsertSchema', () => {
    for (const arm of NON_NULL_ARMS) {
      const result = evolutionWiSessionInsertSchema.safeParse({
        name: 'test',
        holistic_prompt_override: EXPERIMENT_ARMS[arm].prompt!,
      });
      expect(result.success).toBe(true);
    }
  });

  it('Zod deny-list rejects each reserved marker', () => {
    for (const marker of WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS) {
      const result = evolutionWiSessionInsertSchema.safeParse({
        name: 'test',
        holistic_prompt_override: `legitimate prefix\n${marker}\nlegitimate suffix`,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('reserved markers');
      }
    }
  });

  it('Zod rejects an 8001-char override (DB CHECK constraint mirror)', () => {
    const result = evolutionWiSessionInsertSchema.safeParse({
      name: 'test',
      holistic_prompt_override: 'a'.repeat(8001),
    });
    expect(result.success).toBe(false);
  });

  it('Zod accepts a null override (= use default)', () => {
    const result = evolutionWiSessionInsertSchema.safeParse({
      name: 'test',
      holistic_prompt_override: null,
    });
    expect(result.success).toBe(true);
  });

  it('Zod accepts undefined / omitted override (= use default)', () => {
    const result = evolutionWiSessionInsertSchema.safeParse({ name: 'test' });
    expect(result.success).toBe(true);
  });
});

describe('experimentArms — composes correctly with buildComparisonPrompt', () => {
  it('composing each non-null arm produces the override verbatim AND the strict verdict tail', () => {
    for (const arm of NON_NULL_ARMS) {
      const override = EXPERIMENT_ARMS[arm].prompt!;
      const composed = buildComparisonPrompt(
        'TEXT_A_BODY',
        'TEXT_B_BODY',
        'article',
        override,
        false,
        undefined,
        undefined,
        undefined,
        true, // strictVerdictTail
      );
      expect(composed).toContain(override);
      // Strict verdict tail (NOT the reasoning-tolerant "Your answer:" variant).
      expect(composed).toContain('Respond with ONLY one of these exact answers');
      expect(composed).not.toContain('You may include reasoning');
      // Text body framing preserved.
      expect(composed).toContain('## Text A');
      expect(composed).toContain('## Text B');
    }
  });
});

describe('experimentArms — hash registry', () => {
  it('exposes a non-empty registry for every arm', () => {
    for (const arm of ALL_ARMS) {
      expect(ACCEPTED_HASHES[arm].length).toBeGreaterThan(0);
      // SHA-256 hex = 64 chars.
      for (const h of ACCEPTED_HASHES[arm]) {
        expect(h).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('first entry of each registry is the current canonical hash', () => {
    expect(ACCEPTED_HASHES.A[0]).toBe(sha256Hex(ARM_A_CANONICAL_RUBRIC_BLOCK));
    for (const arm of NON_NULL_ARMS) {
      expect(ACCEPTED_HASHES[arm][0]).toBe(sha256Hex(EXPERIMENT_ARMS[arm].prompt!));
    }
  });

  it('every arm self-verifies — the registry hashes match the live prompt strings', () => {
    // Note: this is NOT a regression guard against silent prompt edits — the unit test
    // recomputes the hashes at runtime, so editing a prompt without touching ACCEPTED_HASHES
    // will still pass. The regression guard lives in the Phase 4 analysis script: persisted
    // session overrides on staging hash to OLD values, which won't match the new registry
    // entry unless the operator explicitly appends. The script is the production gate; this
    // test merely confirms the registry's shape is internally consistent.
    for (const arm of ALL_ARMS) {
      const subject = arm === 'A' ? ARM_A_CANONICAL_RUBRIC_BLOCK : EXPERIMENT_ARMS[arm].prompt!;
      expect(verifyArmHash(arm, arm === 'A' ? null : subject)).toBe(true);
      expect(ACCEPTED_HASHES[arm][0]).toBe(sha256Hex(subject));
    }
  });
});

describe('verifyArmHash', () => {
  it('Arm A: NULL override hashes the canonical hardcoded rubric block', () => {
    expect(verifyArmHash('A', null)).toBe(true);
    expect(verifyArmHash('A', ARM_A_CANONICAL_RUBRIC_BLOCK)).toBe(true);
  });

  it('rejects an Arm-B override that has been tampered with', () => {
    const tampered = EXPERIMENT_ARMS.B.prompt + '\n(extra text)';
    expect(verifyArmHash('B', tampered)).toBe(false);
  });

  it('rejects a cross-arm match (Arm B prompt does NOT verify as Arm C)', () => {
    expect(verifyArmHash('C', EXPERIMENT_ARMS.B.prompt)).toBe(false);
  });
});
