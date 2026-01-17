'use client';
/**
 * Admin content management page.
 * Lists all explanations with filtering, sorting, and bulk operations.
 */

import { useState, useCallback } from 'react';
import { ExplanationTable } from '@/components/admin/ExplanationTable';
import { ExplanationDetailModal } from '@/components/admin/ExplanationDetailModal';
import type { AdminExplanation } from '@/lib/services/adminContent';

export default function AdminContentPage() {
  const [selectedExplanation, setSelectedExplanation] = useState<AdminExplanation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Content Management
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            View and manage all explanations
          </p>
        </div>
      </div>

      <ExplanationTable
        key={refreshKey}
        onSelectExplanation={setSelectedExplanation}
      />

      {selectedExplanation && (
        <ExplanationDetailModal
          explanation={selectedExplanation}
          onClose={() => setSelectedExplanation(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
