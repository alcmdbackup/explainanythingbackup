// Phase 5: verify that the agent_invocation_id threads cleanly from agent
// execution (via createVariant) into the persisted row. The real persistence
// call is exercised in E2E; this test verifies the in-memory contract that
// persistRunResults relies on.

import { createVariant } from '../../types';

describe('Phase 5 agent_invocation_id threading', () => {
  it('createVariant carries agentInvocationId through to the persisted Variant', () => {
    const v = createVariant({
      text: 'hello',
      tactic: 'lexical_simplify',
      iterationBorn: 1,
      parentIds: ['parent-id'],
      agentInvocationId: 'inv-123',
    });
    expect(v.agentInvocationId).toBe('inv-123');
    expect(v.parentIds).toEqual(['parent-id']);
  });

  it('omits agentInvocationId when not provided (legacy path)', () => {
    const v = createVariant({
      text: 'hello',
      tactic: 'lexical_simplify',
      iterationBorn: 0,
      parentIds: [],
    });
    expect(v.agentInvocationId).toBeUndefined();
  });

  it('persistRunResults INSERT shape (via evolutionVariantInsertSchema) accepts agent_invocation_id',
     async () => {
    const { evolutionVariantInsertSchema } = await import('@evolution/lib/schemas');
    const row = evolutionVariantInsertSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      run_id: '22222222-2222-2222-2222-222222222222',
      variant_content: 'text',
      parent_variant_id: '33333333-3333-3333-3333-333333333333',
      agent_invocation_id: '44444444-4444-4444-4444-444444444444',
    });
    expect(row.agent_invocation_id).toBe('44444444-4444-4444-4444-444444444444');
  });

  it('evolutionVariantInsertSchema allows null/undefined agent_invocation_id (historic rows)',
     async () => {
    const { evolutionVariantInsertSchema } = await import('@evolution/lib/schemas');
    const row = evolutionVariantInsertSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      run_id: '22222222-2222-2222-2222-222222222222',
      variant_content: 'text',
    });
    expect(row.agent_invocation_id).toBeUndefined();
  });
});
