'use client';
// Row-per-anchor table editor for evolution_criteria.evaluation_guidance.
// Used inside the FormDialog (via FieldDef.type='custom' + render callback)
// for both Create-Criteria and Edit-Criteria flows. Optional: leaving it
// empty means no rubric (LLM receives only name + description + range).
//
// Validation:
//   - Each anchor's score must be ∈ [minRating, maxRating] (red border + tooltip).
//   - Description max 500 chars.
//   - Rendered sorted by score asc regardless of insertion order.

import { useState, useEffect, useCallback } from 'react';

export interface RubricAnchor {
  score: number;
  description: string;
}

export interface RubricEditorProps {
  value: ReadonlyArray<RubricAnchor> | null | undefined;
  onChange: (next: RubricAnchor[]) => void;
  minRating: number;
  maxRating: number;
}

export function RubricEditor({ value, onChange, minRating, maxRating }: RubricEditorProps): JSX.Element {
  const [anchors, setAnchors] = useState<RubricAnchor[]>(() => (value ? [...value] : []));

  // Sync with parent when value prop changes (e.g., dialog reopens with different row).
  useEffect(() => {
    setAnchors(value ? [...value] : []);
  }, [value]);

  const sorted = [...anchors].sort((a, b) => a.score - b.score);

  const updateAnchor = useCallback((index: number, patch: Partial<RubricAnchor>) => {
    setAnchors((curr) => {
      const next = [...curr];
      const existing = next[index];
      if (!existing) return curr;
      next[index] = { score: existing.score, description: existing.description, ...patch };
      onChange(next);
      return next;
    });
  }, [onChange]);

  const addAnchor = useCallback(() => {
    setAnchors((curr) => {
      const next = [...curr, { score: minRating, description: '' }];
      onChange(next);
      return next;
    });
  }, [onChange, minRating]);

  const removeAnchor = useCallback((indexToRemove: number) => {
    setAnchors((curr) => {
      const next = curr.filter((_, i) => i !== indexToRemove);
      onChange(next);
      return next;
    });
  }, [onChange]);

  return (
    <div className="space-y-2" data-testid="rubric-editor">
      <div className="text-xs text-[var(--text-muted)]">
        Anchor scores tell the LLM what each value means. Define as few or many as you want — the LLM interpolates between them.
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)] italic py-2">
          No rubric defined — LLM will receive only name + description + range.
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs text-[var(--text-secondary)]">
              <th className="px-2 py-1 w-20">Score</th>
              <th className="px-2 py-1">Description</th>
              <th className="px-2 py-1 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((anchor) => {
              const originalIndex = anchors.indexOf(anchor);
              const scoreOutOfRange = anchor.score < minRating || anchor.score > maxRating;
              const descriptionEmpty = !anchor.description || anchor.description.trim().length === 0;
              return (
                <tr key={`anchor-${originalIndex}`} data-testid={`rubric-anchor-${originalIndex}`}>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={anchor.score}
                      onChange={(e) => updateAnchor(originalIndex, { score: Number(e.target.value) })}
                      className={`w-full px-2 py-1 border rounded ${scoreOutOfRange ? 'border-red-500' : 'border-[var(--border-default)]'} bg-[var(--bg-input)]`}
                      title={scoreOutOfRange ? `Score must be between ${minRating} and ${maxRating}` : ''}
                      aria-invalid={scoreOutOfRange}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={anchor.description}
                      onChange={(e) => updateAnchor(originalIndex, { description: e.target.value })}
                      maxLength={500}
                      className={`w-full px-2 py-1 border rounded ${descriptionEmpty ? 'border-red-500' : 'border-[var(--border-default)]'} bg-[var(--bg-input)]`}
                      placeholder="What does this score mean?"
                      title={descriptionEmpty ? 'Description required' : ''}
                      aria-invalid={descriptionEmpty}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeAnchor(originalIndex)}
                      className="text-[var(--text-muted)] hover:text-red-500"
                      aria-label="Remove anchor"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button
        type="button"
        onClick={addAnchor}
        className="text-sm px-3 py-1 border border-[var(--border-default)] rounded hover:bg-[var(--bg-elevated)]"
        data-testid="rubric-add-anchor"
      >
        + Add anchor
      </button>
    </div>
  );
}
