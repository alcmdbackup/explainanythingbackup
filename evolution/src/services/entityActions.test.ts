// Tests for generic entity action dispatcher: input validation and routing.

import { executeEntityAction } from './entityActions';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('next/dist/client/components/is-next-router-error', () => ({
  isNextRouterError: jest.fn().mockReturnValue(false),
}));

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockCreateSupabase = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;

// Mock entity registry to avoid real DB calls
const mockExecuteAction = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/core/entityRegistry', () => ({
  getEntity: jest.fn(() => ({
    actions: [
      { key: 'rename', label: 'Rename' },
      { key: 'delete', label: 'Delete' },
    ],
    children: [],
    table: 'mock_table',
    executeAction: mockExecuteAction,
  })),
}));

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

describe('executeEntityAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin-user-id');
    mockCreateSupabase.mockResolvedValue({} as any);
  });

  it('rejects invalid entity type', async () => {
    const result = await executeEntityAction({
      entityType: 'bogus',
      entityId: VALID_UUID,
      actionKey: 'delete',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid entity type');
  });

  it('rejects invalid entity ID', async () => {
    const result = await executeEntityAction({
      entityType: 'run',
      entityId: 'not-a-uuid',
      actionKey: 'delete',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid entity ID');
  });

  it('rejects invalid action key', async () => {
    const result = await executeEntityAction({
      entityType: 'run',
      entityId: VALID_UUID,
      actionKey: 'nuke',
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Invalid action 'nuke'");
  });

  it('calls executeAction for valid input', async () => {
    const result = await executeEntityAction({
      entityType: 'run',
      entityId: VALID_UUID,
      actionKey: 'delete',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      entityType: 'run',
      entityId: VALID_UUID,
      actionKey: 'delete',
      descendantCount: {},
    });
    expect(mockExecuteAction).toHaveBeenCalledWith('delete', VALID_UUID, expect.anything(), undefined);
  });

  it('passes payload through to executeAction', async () => {
    const payload = { name: 'New Name' };
    await executeEntityAction({
      entityType: 'run',
      entityId: VALID_UUID,
      actionKey: 'rename',
      payload,
    });
    expect(mockExecuteAction).toHaveBeenCalledWith('rename', VALID_UUID, expect.anything(), payload);
  });
});
