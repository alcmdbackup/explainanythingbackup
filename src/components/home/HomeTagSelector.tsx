/**
 * Compact tag selector for the home page search panel.
 * Features dropdown chips for Difficulty/Length presets and ability to add simple tags.
 */
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDownIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { getAllTagsAction } from '@/actions/actions';
import { TagFullDbType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';
export type LengthLevel = 'brief' | 'standard' | 'detailed';

export interface HomeTagState {
  difficulty: DifficultyLevel;
  length: LengthLevel;
  simpleTags: string[];
}

interface HomeTagSelectorProps {
  state: HomeTagState;
  onChange: (state: HomeTagState) => void;
  disabled?: boolean;
  className?: string;
}

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const LENGTH_OPTIONS: { value: LengthLevel; label: string }[] = [
  { value: 'brief', label: 'Brief' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailed' },
];

export default function HomeTagSelector({
  state,
  onChange,
  disabled = false,
  className = ''
}: HomeTagSelectorProps) {
  const [openDropdown, setOpenDropdown] = useState<'difficulty' | 'length' | null>(null);
  const [showTagSearch, setShowTagSearch] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [availableTags, setAvailableTags] = useState<TagFullDbType[]>([]);
  const [filteredTags, setFilteredTags] = useState<TagFullDbType[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);

  const difficultyRef = useRef<HTMLDivElement>(null);
  const lengthRef = useRef<HTMLDivElement>(null);
  const tagSearchRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (difficultyRef.current && !difficultyRef.current.contains(event.target as Node)) {
        if (openDropdown === 'difficulty') setOpenDropdown(null);
      }
      if (lengthRef.current && !lengthRef.current.contains(event.target as Node)) {
        if (openDropdown === 'length') setOpenDropdown(null);
      }
      if (tagSearchRef.current && !tagSearchRef.current.contains(event.target as Node)) {
        setShowTagSearch(false);
        setTagSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  // Focus tag input when opened
  useEffect(() => {
    if (showTagSearch && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagSearch]);

  const handleDifficultyChange = useCallback((value: DifficultyLevel) => {
    onChange({ ...state, difficulty: value });
    setOpenDropdown(null);
  }, [state, onChange]);

  const handleLengthChange = useCallback((value: LengthLevel) => {
    onChange({ ...state, length: value });
    setOpenDropdown(null);
  }, [state, onChange]);

  const fetchAvailableTags = useCallback(async () => {
    setIsLoadingTags(true);
    try {
      const result = await getAllTagsAction();
      if (result.success && result.data) {
        // Filter out preset-related tags and already selected tags
        const presetKeywords = ['beginner', 'intermediate', 'advanced', 'brief', 'standard', 'detailed', 'difficulty', 'length'];
        const filtered = result.data.filter(tag => {
          const tagNameLower = tag.tag_name.toLowerCase();
          // Exclude preset-related tags
          if (presetKeywords.some(kw => tagNameLower.includes(kw))) return false;
          // Exclude already selected tags
          if (state.simpleTags.includes(tag.tag_name)) return false;
          return true;
        });
        setAvailableTags(filtered);
        setFilteredTags(filtered);
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    } finally {
      setIsLoadingTags(false);
    }
  }, [state.simpleTags]);

  const handleShowTagSearch = useCallback(() => {
    setShowTagSearch(true);
    setTagSearchQuery('');
    fetchAvailableTags();
  }, [fetchAvailableTags]);

  const handleTagSearchChange = useCallback((query: string) => {
    setTagSearchQuery(query);
    if (!query.trim()) {
      setFilteredTags(availableTags);
    } else {
      const filtered = availableTags.filter(tag =>
        tag.tag_name.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredTags(filtered);
    }
  }, [availableTags]);

  const handleAddTag = useCallback((tag: TagFullDbType) => {
    if (!state.simpleTags.includes(tag.tag_name)) {
      onChange({ ...state, simpleTags: [...state.simpleTags, tag.tag_name] });
    }
    setShowTagSearch(false);
    setTagSearchQuery('');
  }, [state, onChange]);

  const handleRemoveTag = useCallback((tagName: string) => {
    onChange({ ...state, simpleTags: state.simpleTags.filter(t => t !== tagName) });
  }, [state, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowTagSearch(false);
      setTagSearchQuery('');
    }
  };

  const getDifficultyLabel = () => DIFFICULTY_OPTIONS.find(o => o.value === state.difficulty)?.label || 'Intermediate';
  const getLengthLabel = () => LENGTH_OPTIONS.find(o => o.value === state.length)?.label || 'Standard';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-sm text-[var(--text-muted)]">Tags:</span>

      {/* Difficulty dropdown */}
      <div ref={difficultyRef} className="relative">
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === 'difficulty' ? null : 'difficulty')}
          disabled={disabled}
          aria-expanded={openDropdown === 'difficulty'}
          data-testid="home-tag-difficulty"
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1 text-sm',
            'bg-[var(--surface-elevated)] border border-[var(--border-default)]',
            'text-[var(--text-secondary)] rounded-page',
            'transition-all duration-200',
            'hover:border-[var(--accent-gold)] hover:shadow-warm-sm',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            openDropdown === 'difficulty' && 'border-[var(--accent-gold)]'
          )}
        >
          {getDifficultyLabel()}
          <ChevronDownIcon className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            openDropdown === 'difficulty' && 'rotate-180'
          )} />
        </button>
        {openDropdown === 'difficulty' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page shadow-warm-lg py-1 min-w-[120px]">
            {DIFFICULTY_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleDifficultyChange(option.value)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm font-ui transition-colors duration-150',
                  state.difficulty === option.value
                    ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Length dropdown */}
      <div ref={lengthRef} className="relative">
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === 'length' ? null : 'length')}
          disabled={disabled}
          aria-expanded={openDropdown === 'length'}
          data-testid="home-tag-length"
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1 text-sm',
            'bg-[var(--surface-elevated)] border border-[var(--border-default)]',
            'text-[var(--text-secondary)] rounded-page',
            'transition-all duration-200',
            'hover:border-[var(--accent-gold)] hover:shadow-warm-sm',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            openDropdown === 'length' && 'border-[var(--accent-gold)]'
          )}
        >
          {getLengthLabel()}
          <ChevronDownIcon className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            openDropdown === 'length' && 'rotate-180'
          )} />
        </button>
        {openDropdown === 'length' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page shadow-warm-lg py-1 min-w-[120px]">
            {LENGTH_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleLengthChange(option.value)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm font-ui transition-colors duration-150',
                  state.length === option.value
                    ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Simple tag chips */}
      {state.simpleTags.map(tagName => (
        <span
          key={tagName}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1 text-sm',
            'bg-[var(--surface-elevated)] border border-[var(--border-default)]',
            'text-[var(--text-secondary)] rounded-page'
          )}
        >
          {tagName}
          <button
            type="button"
            onClick={() => handleRemoveTag(tagName)}
            disabled={disabled}
            className="p-0.5 rounded-full hover:text-[var(--accent-copper)] transition-colors"
            aria-label={`Remove ${tagName}`}
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}

      {/* Add tag button/input */}
      <div ref={tagSearchRef} className="relative">
        {showTagSearch ? (
          <div className="flex items-center gap-1">
            <input
              ref={tagInputRef}
              type="text"
              value={tagSearchQuery}
              onChange={(e) => handleTagSearchChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search tags..."
              disabled={disabled}
              data-testid="home-tag-search-input"
              className={cn(
                'w-32 px-2 py-1 text-sm rounded-page',
                'bg-[var(--surface-input)] border border-[var(--border-default)]',
                'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:border-[var(--accent-gold)]',
                'transition-colors duration-200'
              )}
            />
            <button
              type="button"
              onClick={() => {
                setShowTagSearch(false);
                setTagSearchQuery('');
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleShowTagSearch}
            disabled={disabled}
            data-testid="home-add-tag-button"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-sm',
              'text-[var(--text-muted)] hover:text-[var(--accent-gold)]',
              'transition-colors duration-200',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add tag
          </button>
        )}

        {/* Tag dropdown */}
        {showTagSearch && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page shadow-warm-lg py-1 min-w-[180px] max-h-48 overflow-y-auto">
            {isLoadingTags ? (
              <div className="px-3 py-2 text-sm text-[var(--text-muted)]">Loading...</div>
            ) : filteredTags.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[var(--text-muted)]">No tags found</div>
            ) : (
              filteredTags.slice(0, 10).map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleAddTag(tag)}
                  data-testid="home-tag-option"
                  className="w-full text-left px-3 py-2 text-sm font-ui transition-colors duration-150 text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]"
                >
                  {tag.tag_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
