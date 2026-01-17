'use client';
/**
 * Admin content reports page.
 * Shows user-submitted reports for admin review.
 */

import { ReportsTable } from '@/components/admin/ReportsTable';

export default function AdminReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Content Reports
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Review user-submitted reports about content
        </p>
      </div>

      <ReportsTable initialStatus="pending" />
    </div>
  );
}
