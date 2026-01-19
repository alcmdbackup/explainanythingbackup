'use client';
/**
 * Admin whitelist management component with accessibility support.
 * Manages canonical terms and aliases for link whitelisting.
 */

import { useState, useEffect, useCallback, useId } from 'react';
import FocusTrap from 'focus-trap-react';
import { toast } from 'sonner';
import {
  getAllWhitelistTermsAction,
  createWhitelistTermAction,
  updateWhitelistTermAction,
  deleteWhitelistTermAction,
  getAliasesForTermAction,
  addAliasesAction,
  removeAliasAction
} from '@/actions/actions';
import type { LinkWhitelistFullType, LinkAliasFullType, LinkWhitelistInsertType } from '@/lib/schemas/schemas';

type ModalMode = 'create' | 'edit' | 'aliases' | null;

export default function WhitelistContent() {
  const [terms, setTerms] = useState<LinkWhitelistFullType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalTitleId = useId();

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedTerm, setSelectedTerm] = useState<LinkWhitelistFullType | null>(null);

  // Form state
  const [formData, setFormData] = useState<Partial<LinkWhitelistInsertType>>({
    canonical_term: '',
    standalone_title: '',
    description: '',
    is_active: true
  });

  // Alias state
  const [aliases, setAliases] = useState<LinkAliasFullType[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [aliasLoading, setAliasLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const loadTerms = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getAllWhitelistTermsAction();
    if (result.success && result.data) {
      setTerms(result.data);
    } else {
      setError(result.error?.message || 'Failed to load whitelist terms');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  const openCreateModal = () => {
    setFormData({
      canonical_term: '',
      standalone_title: '',
      description: '',
      is_active: true
    });
    setSelectedTerm(null);
    setModalMode('create');
  };

  const openEditModal = (term: LinkWhitelistFullType) => {
    setFormData({
      canonical_term: term.canonical_term,
      standalone_title: term.standalone_title,
      description: term.description || '',
      is_active: term.is_active
    });
    setSelectedTerm(term);
    setModalMode('edit');
  };

  const openAliasModal = async (term: LinkWhitelistFullType) => {
    setSelectedTerm(term);
    setAliasLoading(true);
    setModalMode('aliases');

    const result = await getAliasesForTermAction(term.id);
    if (result.success && result.data) {
      setAliases(result.data);
    }
    setAliasLoading(false);
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedTerm(null);
    setAliases([]);
    setNewAlias('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.canonical_term || !formData.standalone_title) return;

    setSaving(true);

    if (modalMode === 'create') {
      const result = await createWhitelistTermAction(formData as LinkWhitelistInsertType);
      if (result.success) {
        toast.success('Whitelist term created successfully');
        await loadTerms();
        closeModal();
      } else {
        setError(result.error?.message || 'Failed to create term');
      }
    } else if (modalMode === 'edit' && selectedTerm) {
      const result = await updateWhitelistTermAction(selectedTerm.id, formData);
      if (result.success) {
        toast.success('Whitelist term updated successfully');
        await loadTerms();
        closeModal();
      } else {
        setError(result.error?.message || 'Failed to update term');
      }
    }

    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this term? This will also delete all its aliases.')) {
      return;
    }

    const result = await deleteWhitelistTermAction(id);
    if (result.success) {
      toast.success('Whitelist term deleted successfully');
      await loadTerms();
    } else {
      setError(result.error?.message || 'Failed to delete term');
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.trim() || !selectedTerm) return;

    setAliasLoading(true);
    const result = await addAliasesAction(selectedTerm.id, [newAlias.trim()]);
    if (result.success && result.data) {
      toast.success('Alias added successfully');
      setAliases([...aliases, ...result.data]);
      setNewAlias('');
    }
    setAliasLoading(false);
  };

  const handleRemoveAlias = async (aliasId: number) => {
    setAliasLoading(true);
    const result = await removeAliasAction(aliasId);
    if (result.success) {
      toast.success('Alias removed successfully');
      setAliases(aliases.filter(a => a.id !== aliasId));
    }
    setAliasLoading(false);
  };

  if (loading) {
    return (
      <div className="scholar-card p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-[var(--text-secondary)]">
          {terms.length} term{terms.length !== 1 ? 's' : ''} in whitelist
        </p>
        <button
          onClick={openCreateModal}
          data-testid="admin-whitelist-add-term"
          className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--text-on-primary)] rounded hover:opacity-90 transition-opacity"
        >
          Add Term
        </button>
      </div>

      <div className="scholar-card overflow-hidden" data-testid="admin-whitelist-table">
        <table className="w-full">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Term</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Standalone Title</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[var(--text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-default)]">
            {terms.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  No whitelist terms yet. Add one to get started.
                </td>
              </tr>
            ) : (
              terms.map((term) => (
                <tr key={term.id} data-testid={`admin-whitelist-row-${term.id}`} className="hover:bg-[var(--surface-secondary)]">
                  <td className="px-4 py-3 text-[var(--text-primary)]">{term.canonical_term}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{term.standalone_title}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        term.is_active
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {term.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => openAliasModal(term)}
                      data-testid={`admin-whitelist-aliases-${term.id}`}
                      className="px-3 py-1 text-sm text-[var(--accent-gold)] hover:underline"
                    >
                      Aliases
                    </button>
                    <button
                      onClick={() => openEditModal(term)}
                      data-testid={`admin-whitelist-edit-${term.id}`}
                      className="px-3 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(term.id)}
                      data-testid={`admin-whitelist-delete-${term.id}`}
                      className="px-3 py-1 text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modalMode && (
        <FocusTrap>
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            data-testid="admin-whitelist-modal"
          >
            <div className="bg-[var(--surface-primary)] rounded-lg shadow-warm-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 id={modalTitleId} className="text-xl font-display text-[var(--text-primary)]">
                    {modalMode === 'create' && 'Add Whitelist Term'}
                    {modalMode === 'edit' && 'Edit Whitelist Term'}
                    {modalMode === 'aliases' && `Aliases for "${selectedTerm?.canonical_term}"`}
                  </h2>
                  <button
                    onClick={closeModal}
                    data-testid="admin-whitelist-modal-close"
                    aria-label="Close modal"
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    &times;
                  </button>
                </div>

              {(modalMode === 'create' || modalMode === 'edit') && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">
                      Canonical Term *
                    </label>
                    <input
                      type="text"
                      value={formData.canonical_term || ''}
                      onChange={(e) => setFormData({ ...formData, canonical_term: e.target.value })}
                      data-testid="admin-whitelist-canonical-term"
                      className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">
                      Standalone Title *
                    </label>
                    <input
                      type="text"
                      value={formData.standalone_title || ''}
                      onChange={(e) => setFormData({ ...formData, standalone_title: e.target.value })}
                      data-testid="admin-whitelist-standalone-title"
                      className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--text-secondary)] mb-1">
                      Description
                    </label>
                    <textarea
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      data-testid="admin-whitelist-description"
                      rows={3}
                      className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      data-testid="admin-whitelist-is-active"
                      className="rounded border-[var(--border-default)]"
                    />
                    <label htmlFor="is_active" className="text-sm text-[var(--text-secondary)]">
                      Active
                    </label>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeModal}
                      data-testid="admin-whitelist-cancel"
                      className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      data-testid="admin-whitelist-submit"
                      className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--text-on-primary)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : modalMode === 'create' ? 'Create' : 'Update'}
                    </button>
                  </div>
                </form>
              )}

              {modalMode === 'aliases' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      placeholder="New alias..."
                      data-testid="admin-whitelist-alias-input"
                      className="flex-1 px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                    />
                    <button
                      onClick={handleAddAlias}
                      disabled={aliasLoading || !newAlias.trim()}
                      data-testid="admin-whitelist-add-alias"
                      className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--text-on-primary)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>

                  {aliasLoading ? (
                    <div className="animate-pulse space-y-2">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-10 bg-[var(--surface-elevated)] rounded" />
                      ))}
                    </div>
                  ) : aliases.length === 0 ? (
                    <p className="text-[var(--text-muted)] text-center py-4" data-testid="admin-whitelist-no-aliases">
                      No aliases yet. Add one above.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--border-default)]" data-testid="admin-whitelist-alias-list">
                      {aliases.map((alias) => (
                        <li key={alias.id} className="flex justify-between items-center py-2" data-testid={`admin-whitelist-alias-${alias.id}`}>
                          <span className="text-[var(--text-primary)]">{alias.alias_term}</span>
                          <button
                            onClick={() => handleRemoveAlias(alias.id)}
                            data-testid={`admin-whitelist-remove-alias-${alias.id}`}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex justify-end pt-4">
                    <button
                      onClick={closeModal}
                      data-testid="admin-whitelist-close-aliases"
                      className="px-4 py-2 bg-[var(--surface-elevated)] text-[var(--text-primary)] rounded hover:opacity-90"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </FocusTrap>
      )}
    </div>
  );
}
