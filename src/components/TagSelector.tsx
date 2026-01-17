'use client';

/**
 * TagSelector - Compact tag selection UI for use in modals and panels
 * Displays available tags and allows toggling their active state
 */

import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TagFullDbType, TagUIType } from '@/lib/schemas/schemas';
import { getAllTagsAction } from '@/actions/actions';
import { TagModeState, TagModeAction, getCurrentTags } from '@/reducers/tagModeReducer';

interface TagSelectorProps {
  tagState: TagModeState;
  dispatch: React.Dispatch<TagModeAction>;
  disabled?: boolean;
  className?: string;
}

/**
 * Compact tag selector for modals - shows current tags with toggle capability
 */
export default function TagSelector({
  tagState,
  dispatch,
  disabled = false,
  className
}: TagSelectorProps) {
  const tags = getCurrentTags(tagState);
  const [availableTags, setAvailableTags] = useState<TagFullDbType[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);

  // Load available tags on mount
  useEffect(() => {
    const loadTags = async () => {
      setIsLoadingTags(true);
      try {
        const result = await getAllTagsAction();
        if (result && result.success && result.data) {
          setAvailableTags(result.data);
        }
      } catch (error) {
        console.error('Failed to load available tags:', error);
      } finally {
        setIsLoadingTags(false);
      }
    };
    loadTags();
  }, []);

  // Get tags not already in the current list
  const addableTags = useMemo(() => {
    const currentTagIds = new Set(
      tags.map(t => 'id' in t ? t.id : t.tags[0]?.id).filter(Boolean)
    );
    return availableTags.filter(t => !currentTagIds.has(t.id));
  }, [availableTags, tags]);

  const handleToggleTag = (tagIndex: number) => {
    if (disabled) return;
    const tag = tags[tagIndex];
    if (!tag) return;

    // Create updated tags array with toggled tag
    const updatedTags = tags.map((t, i) => {
      if (i !== tagIndex) return t;
      if ('tag_name' in t) {
        return { ...t, tag_active_current: !t.tag_active_current };
      } else {
        return { ...t, tag_active_current: !t.tag_active_current };
      }
    });

    dispatch({ type: 'UPDATE_TAGS', tags: updatedTags });
  };

  const handleAddTag = (tag: TagFullDbType) => {
    if (disabled) return;

    // Add as a simple TagUIType
    const newTag: TagUIType = {
      id: tag.id,
      tag_name: tag.tag_name,
      tag_description: tag.tag_description,
      presetTagId: tag.presetTagId,
      created_at: tag.created_at,
      tag_active_initial: false,
      tag_active_current: true
    };

    dispatch({ type: 'UPDATE_TAGS', tags: [...tags, newTag] });
    setShowAddDropdown(false);
  };

  const handleRemoveTag = (tagIndex: number) => {
    if (disabled) return;
    const updatedTags = tags.filter((_, i) => i !== tagIndex);
    dispatch({ type: 'UPDATE_TAGS', tags: updatedTags });
  };

  // Helper to get tag display info
  const getTagInfo = (tag: TagUIType) => {
    if ('tag_name' in tag) {
      return {
        name: tag.tag_name,
        description: tag.tag_description,
        isActive: tag.tag_active_current
      };
    } else {
      const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
      return {
        name: currentTag?.tag_name || 'Unknown',
        description: currentTag?.tag_description || '',
        isActive: tag.tag_active_current
      };
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="tag-selector">
      <label className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider">
        Tags
      </label>

      {/* Current tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, index) => {
            const { name, isActive } = getTagInfo(tag);
            return (
              <div
                key={index}
                className={cn(
                  'group flex items-center gap-1 px-2 py-1 rounded-md border text-sm transition-all duration-200',
                  isActive
                    ? 'bg-[var(--accent-gold)]/10 border-[var(--accent-gold)] text-[var(--accent-copper)]'
                    : 'bg-[var(--surface-elevated)] border-[var(--border-default)] text-[var(--text-muted)]',
                  disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                )}
                onClick={() => handleToggleTag(index)}
                data-testid={`tag-chip-${index}`}
              >
                <span className="text-xs">{name}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(index);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-opacity"
                    aria-label={`Remove ${name}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add tag button/dropdown */}
      {!disabled && addableTags.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAddDropdown(!showAddDropdown)}
            className="flex items-center gap-1 text-xs text-[var(--accent-gold)] hover:text-[var(--accent-copper)] transition-colors"
            data-testid="add-tag-button"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add tag
          </button>

          {showAddDropdown && (
            <div
              className="absolute z-10 mt-1 w-48 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-md shadow-warm-lg max-h-48 overflow-y-auto"
              data-testid="add-tag-dropdown"
            >
              {isLoadingTags ? (
                <div className="p-2 text-xs text-[var(--text-muted)]">Loading tags...</div>
              ) : (
                addableTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAddTag(tag)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--surface-tertiary)] transition-colors"
                  >
                    {tag.tag_name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {tags.length === 0 && !disabled && (
        <p className="text-xs text-[var(--text-muted)]">
          No tags selected. Add tags to customize the AI output.
        </p>
      )}
    </div>
  );
}
