// Clean up orphaned LLM budget reservations from crashed processes.

import { getSpendingGate } from '@/lib/services/llmSpendingGate';

export async function cleanupOrphanedReservations(): Promise<void> {
  const gate = getSpendingGate();
  await gate.cleanupOrphanedReservations();
}
