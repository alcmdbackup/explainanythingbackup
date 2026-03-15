// Tests for orphaned reservations cleanup ops module.

const mockCleanup = jest.fn();

jest.mock('@/lib/services/llmSpendingGate', () => ({
  getSpendingGate: jest.fn().mockReturnValue({
    cleanupOrphanedReservations: () => mockCleanup(),
  }),
}));

import { cleanupOrphanedReservations } from './orphanedReservations';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('cleanupOrphanedReservations', () => {
  it('calls spending gate cleanup', async () => {
    mockCleanup.mockResolvedValue(undefined);
    await cleanupOrphanedReservations();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from spending gate', async () => {
    mockCleanup.mockRejectedValue(new Error('DB connection failed'));
    await expect(cleanupOrphanedReservations()).rejects.toThrow('DB connection failed');
  });
});
