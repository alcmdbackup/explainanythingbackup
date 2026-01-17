'use client';
/**
 * Admin settings page.
 * Manages feature flags and system configuration.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getFeatureFlagsAction,
  updateFeatureFlagAction,
  createFeatureFlagAction,
  type FeatureFlag
} from '@/lib/services/featureFlags';

export default function AdminSettingsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New flag form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getFeatureFlagsAction();
    if (result.success && result.data) {
      setFlags(result.data);
    } else {
      setError(result.error?.message || 'Failed to load feature flags');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const handleToggle = async (flag: FeatureFlag) => {
    setUpdating(flag.id);
    setError(null);

    const result = await updateFeatureFlagAction({
      id: flag.id,
      enabled: !flag.enabled
    });

    if (result.success) {
      setFlags(prev => prev.map(f =>
        f.id === flag.id ? { ...f, enabled: !f.enabled, updated_at: new Date().toISOString() } : f
      ));
    } else {
      setError(result.error?.message || 'Failed to update flag');
    }

    setUpdating(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    setError(null);

    const result = await createFeatureFlagAction({
      name: newName.trim().toLowerCase().replace(/\s+/g, '_'),
      description: newDescription.trim() || undefined
    });

    if (result.success && result.data) {
      setFlags(prev => [...prev, result.data!].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewDescription('');
      setShowNewForm(false);
    } else {
      setError(result.error?.message || 'Failed to create flag');
    }

    setCreating(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
          <p className="text-[var(--text-secondary)]">
            Manage feature flags and system configuration
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded hover:opacity-90"
        >
          Add Flag
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* New Flag Form */}
      {showNewForm && (
        <div className="mb-6 p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">Create New Flag</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Flag Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., enable_new_feature"
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                required
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Use snake_case. Will be converted automatically.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Description
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What does this flag control?"
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded hover:opacity-90 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Flag'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewForm(false); setNewName(''); setNewDescription(''); }}
                className="px-4 py-2 border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feature Flags Table */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Feature Flags</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
        ) : flags.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">No feature flags configured</div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className="p-4 flex items-center justify-between hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-[var(--text-primary)]">
                      {flag.name}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      flag.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {flag.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {flag.description && (
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                      {flag.description}
                    </p>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Last updated: {formatDate(flag.updated_at)}
                  </p>
                </div>
                <div className="ml-4">
                  <button
                    onClick={() => handleToggle(flag)}
                    disabled={updating === flag.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      flag.enabled ? 'bg-green-500' : 'bg-gray-300'
                    } ${updating === flag.id ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        flag.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Additional Settings Section */}
      <div className="mt-8 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">System Settings</h2>
        <p className="text-[var(--text-muted)]">
          Additional system configuration options will be added here.
        </p>
      </div>
    </div>
  );
}
