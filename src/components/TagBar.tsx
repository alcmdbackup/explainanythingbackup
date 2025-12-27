/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useRef, useEffect } from 'react';
import { TagFullDbType, TagUIType, FeedbackMode } from '@/lib/schemas/schemas';
import { getAllTagsAction } from '@/actions/actions';
import { handleApplyForModifyTags } from '@/lib/services/explanationTags';
import { FeedbackModeState, FeedbackModeAction, getCurrentTags, getFeedbackMode, isTagsModified as getIsTagsModified } from '@/reducers/tagModeReducer';

interface TagBarProps {
    tagState: FeedbackModeState;
    dispatch: React.Dispatch<FeedbackModeAction>;
    className?: string;
    onTagClick?: (tag: TagFullDbType) => void;
    explanationId?: number | null;
    tagBarApplyClickHandler?: (tagDescriptions: string[]) => void;
    isStreaming?: boolean;
    /** When true, skip panel styling and buttons (for embedding in FeedbackPanel) */
    embedded?: boolean;
}

/**
 * Displays tags in a horizontal bar with bookmark-style styling
 * Midnight Scholar theme - Tags as elegant bookmarks with gold accents
 */
export default function TagBar({ tagState, dispatch, className = '', onTagClick, explanationId, tagBarApplyClickHandler, isStreaming = false, embedded = false }: TagBarProps) {
    const tags = getCurrentTags(tagState);
    const feedbackMode = getFeedbackMode(tagState);
    const effectiveIsTagsModified = getIsTagsModified(tagState);
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const [showModifiedMenu, setShowModifiedMenu] = useState(false);
    const [showAddTagInput, setShowAddTagInput] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [availableTags, setAvailableTags] = useState<TagFullDbType[]>([]);
    const [filteredAvailableTags, setFilteredAvailableTags] = useState<TagFullDbType[]>([]);
    const [isLoadingAvailableTags, setIsLoadingAvailableTags] = useState(false);
    const [showAvailableTagsDropdown, setShowAvailableTagsDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const modifiedMenuRef = useRef<HTMLDivElement>(null);
    const addTagInputRef = useRef<HTMLInputElement>(null);
    const availableTagsDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
            if (modifiedMenuRef.current && !modifiedMenuRef.current.contains(event.target as Node)) {
                setShowModifiedMenu(false);
            }
            if (availableTagsDropdownRef.current && !availableTagsDropdownRef.current.contains(event.target as Node)) {
                setShowAvailableTagsDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        if (showAddTagInput && addTagInputRef.current) {
            addTagInputRef.current.focus();
        }
    }, [showAddTagInput]);

    const handleReset = () => {
        dispatch({ type: 'RESET_TAGS' });
        setShowModifiedMenu(false);
    };

    const handleApplyRouter = async () => {
        if (feedbackMode === FeedbackMode.Normal && !explanationId) {
            console.error('No explanation ID provided for applying tags');
            return;
        }

        if (feedbackMode === FeedbackMode.RewriteWithFeedback) {
            await handleApplyRewriteWithFeedback();
        } else if (feedbackMode === FeedbackMode.EditWithFeedback) {
            await handleApplyEditWithFeedback();
        } else {
            await handleApplyNormal();
        }
    };

    const extractActiveTagDescriptions = (): string[] => {
        const tagDescriptions: string[] = [];
        tags.forEach(tag => {
            if ('tag_name' in tag) {
                if (tag.tag_active_current) {
                    tagDescriptions.push(tag.tag_description);
                }
            } else {
                if (tag.tag_active_current) {
                    const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
                    if (currentTag) {
                        tagDescriptions.push(currentTag.tag_description);
                    }
                }
            }
        });
        return tagDescriptions;
    };

    const handleApplyRewriteWithFeedback = async () => {
        if (tagBarApplyClickHandler) {
            const tagDescriptions = extractActiveTagDescriptions();
            tagBarApplyClickHandler(tagDescriptions);
        }
    };

    const handleApplyEditWithFeedback = async () => {
        if (tagBarApplyClickHandler) {
            const tagDescriptions = extractActiveTagDescriptions();
            tagBarApplyClickHandler(tagDescriptions);
        }
    };

    const handleApplyNormal = async () => {
        try {
            const result = await handleApplyForModifyTags(explanationId!, tags);

            if (result.errors.length > 0) {
                console.error('Errors applying tags:', result.errors);
                return;
            }

            dispatch({ type: 'APPLY_TAGS' });
            setShowModifiedMenu(false);
        } catch (error) {
            console.error('Error applying tags:', error);
        }
    };

    const handlePresetTagClick = (presetTag: any) => {
        if (openDropdown === presetTag.originalTagId) {
            setOpenDropdown(null);
            return;
        }
        setOpenDropdown(presetTag.originalTagId);
    };

    const handleSimpleTagClick = (tag: any) => {
        setOpenDropdown(null);
        if (onTagClick) {
            onTagClick(tag);
        }
    };

    const handleDropdownTagClick = (selectedTag: TagFullDbType, presetTagIndex: number) => {
        setOpenDropdown(null);

        const updatedTags = tags.map((tag, idx) => {
            if (idx === presetTagIndex && 'tags' in tag) {
                return { ...tag, tags: [...tag.tags], currentActiveTagId: selectedTag.id };
            }
            return 'tags' in tag ? { ...tag, tags: [...tag.tags] } : { ...tag };
        });

        dispatch({ type: 'UPDATE_TAGS', tags: updatedTags });

        if (onTagClick) {
            onTagClick(selectedTag);
        }
    };

    const handleRemoveTag = (tagIndex: number) => {
        const updatedTags = tags.map(tag =>
            'tags' in tag
                ? { ...tag, tags: [...tag.tags] }
                : { ...tag }
        );
        updatedTags[tagIndex].tag_active_current = false;
        dispatch({ type: 'UPDATE_TAGS', tags: updatedTags });
    };

    const handleRestoreTag = (tagIndex: number) => {
        const updatedTags = tags.map(tag =>
            'tags' in tag
                ? { ...tag, tags: [...tag.tags] }
                : { ...tag }
        );
        updatedTags[tagIndex].tag_active_current = true;
        dispatch({ type: 'UPDATE_TAGS', tags: updatedTags });
    };

    const handleShowAddTagInput = () => {
        setShowAddTagInput(true);
        setNewTagName('');
        fetchAvailableTags();
        setShowAvailableTagsDropdown(true);
    };

    const handleAddTagSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTagName.trim()) {
            filterAvailableTags(newTagName.trim());
        } else {
            setFilteredAvailableTags(availableTags);
            setShowAvailableTagsDropdown(true);
        }
    };

    const handleCancelAddTag = () => {
        setShowAddTagInput(false);
        setNewTagName('');
        setShowAvailableTagsDropdown(false);
    };

    const handleAddTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleCancelAddTag();
        }
    };

    const fetchAvailableTags = async () => {
        setIsLoadingAvailableTags(true);
        try {
            const result = await getAllTagsAction();
            if (result.success && result.data) {
                const excludedTagIds = new Set<number>();
                tags.forEach(tag => {
                    if ('tag_name' in tag) {
                        if (tag.tag_active_current) {
                            excludedTagIds.add(tag.id);
                        }
                    } else {
                        excludedTagIds.add(tag.currentActiveTagId);
                        tag.tags.forEach(presetTag => {
                            excludedTagIds.add(presetTag.id);
                        });
                    }
                });

                const filteredTags = result.data.filter(tag => !excludedTagIds.has(tag.id));
                setAvailableTags(filteredTags);
                setFilteredAvailableTags(filteredTags);
            }
        } catch (error) {
            console.error('Failed to fetch available tags:', error);
        } finally {
            setIsLoadingAvailableTags(false);
        }
    };

    const filterAvailableTags = (searchTerm: string) => {
        setNewTagName(searchTerm);
        if (!searchTerm.trim()) {
            setFilteredAvailableTags(availableTags);
        } else {
            const filtered = availableTags.filter(tag =>
                tag.tag_name.toLowerCase().includes(searchTerm.toLowerCase())
            );
            setFilteredAvailableTags(filtered);
        }
        setShowAvailableTagsDropdown(true);
    };

    const handleAddSelectedTag = (selectedTag: TagFullDbType) => {
        const newTag: TagUIType = {
            ...selectedTag,
            tag_active_current: true,
            tag_active_initial: false
        };

        dispatch({ type: 'UPDATE_TAGS', tags: [...tags, newTag] });
        setShowAddTagInput(false);
        setNewTagName('');
        setShowAvailableTagsDropdown(false);
    };

    // Streaming state - show disabled placeholder
    if (isStreaming) {
        return (
            <div className={`relative ${className}`}>
                <div className="flex flex-wrap items-center gap-2 py-3">
                    <span className="text-sm font-ui font-medium text-[var(--text-muted)]">
                        Tags:
                    </span>
                    <button
                        disabled={true}
                        className="bookmark-tag opacity-50 cursor-not-allowed"
                        title="Add tag (disabled during streaming)"
                    >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Add tag
                    </button>
                </div>
            </div>
        );
    }

    if (!tags || tags.length === 0) {
        return null;
    }

    const isTagsModified = effectiveIsTagsModified;

    // Reusable tag chip component
    const TagChip = ({ tag, index, isActive, isPreset, isModified }: {
        tag: any;
        index: number;
        isActive: boolean;
        isPreset?: boolean;
        isModified?: boolean
    }) => {
        const currentTag = isPreset ? (tag.tags.find((t: TagFullDbType) => t.id === tag.currentActiveTagId) || tag.tags[0]) : tag;

        return (
            <div key={isPreset ? tag.originalTagId : tag.id} className="relative">
                <span
                    data-testid={isPreset ? undefined : "tag-item"}
                    className={`
                        inline-flex items-center px-3 py-1
                        text-xs font-ui font-medium
                        border-l-3 rounded-r-page
                        transition-all duration-200 cursor-pointer
                        ${isActive
                            ? isModified
                                ? 'bg-[var(--surface-elevated)] text-[var(--accent-copper)] border-l-[var(--accent-copper)] border border-[var(--accent-copper)]/30 hover:shadow-warm'
                                : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] border-l-[var(--accent-gold)] border border-[var(--border-default)] hover:border-[var(--accent-gold)] hover:shadow-warm hover:-translate-y-0.5'
                            : 'bg-[var(--surface-primary)] text-[var(--text-muted)] border-l-[var(--border-strong)] border border-[var(--border-default)] line-through opacity-60 hover:opacity-80'
                        }
                    `}
                    style={{ borderLeftWidth: '3px' }}
                    title={isActive ? currentTag?.tag_description : `Removed: ${currentTag?.tag_description} (click to restore)`}
                    onClick={() => {
                        if (isPreset) {
                            handlePresetTagClick(tag);
                        } else if (isActive) {
                            handleSimpleTagClick(tag);
                        } else {
                            handleRestoreTag(index);
                        }
                    }}
                >
                    {currentTag?.tag_name}
                    {isPreset && (
                        <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    )}
                    <button
                        data-testid={isPreset ? undefined : `tag-remove-${index}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isActive) {
                                handleRemoveTag(index);
                            } else {
                                handleRestoreTag(index);
                            }
                        }}
                        className="ml-1.5 hover:text-[var(--accent-gold)] transition-colors"
                        title={isActive ? "Remove tag" : "Restore tag"}
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isActive ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            )}
                        </svg>
                    </button>
                </span>

                {/* Dropdown for preset tags */}
                {isPreset && openDropdown === tag.originalTagId && (
                    <div
                        ref={dropdownRef}
                        className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page shadow-warm-lg py-1 min-w-[150px]"
                    >
                        {tag.tags.map((dropdownTag: TagFullDbType) => (
                            <button
                                key={dropdownTag.id}
                                className={`w-full text-left px-3 py-2 text-sm font-ui transition-colors duration-150 flex items-center justify-between ${
                                    dropdownTag.id === tag.currentActiveTagId
                                        ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]'
                                }`}
                                onClick={() => handleDropdownTagClick(dropdownTag, index)}
                            >
                                <span>{dropdownTag.tag_name}</span>
                                {dropdownTag.id === tag.currentActiveTagId && (
                                    <svg className="w-4 h-4 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Add tag input component
    const AddTagInput = ({ isDarkBg = false }: { isDarkBg?: boolean }) => (
        showAddTagInput ? (
            <div className="relative inline-flex items-center">
                <form onSubmit={handleAddTagSubmit} className="inline-flex items-center">
                    <input
                        data-testid="tag-add-input"
                        ref={addTagInputRef}
                        type="text"
                        value={newTagName}
                        onChange={(e) => filterAvailableTags(e.target.value)}
                        onKeyDown={handleAddTagKeyDown}
                        placeholder="Search tags..."
                        className={`
                            px-3 py-1 text-xs font-body italic
                            border rounded-page
                            focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)]
                            min-w-[140px] transition-all duration-200
                            ${isDarkBg
                                ? 'bg-[var(--surface-elevated)] border-[var(--border-strong)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]'
                                : 'bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]'
                            }
                        `}
                        maxLength={50}
                    />
                    {isLoadingAvailableTags ? (
                        <svg className="animate-spin h-4 w-4 text-[var(--accent-gold)] ml-2" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <>
                            <button
                                data-testid="tag-add-button"
                                type="submit"
                                className="ml-1.5 px-2.5 py-1 text-xs font-ui font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-page transition-all duration-200 hover:shadow-warm"
                            >
                                Add
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelAddTag}
                                data-testid="tag-cancel-button"
                                className="ml-1 px-2.5 py-1 text-xs font-ui font-medium text-[var(--text-muted)] bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-page transition-all duration-200 hover:border-[var(--accent-copper)]"
                            >
                                Cancel
                            </button>
                        </>
                    )}

                    {/* Available tags dropdown */}
                    {showAvailableTagsDropdown && filteredAvailableTags.length > 0 && (
                        <div
                            ref={availableTagsDropdownRef}
                            data-testid="tag-dropdown"
                            className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page shadow-warm-lg py-1 min-w-[200px] max-h-48 overflow-y-auto"
                        >
                            {filteredAvailableTags.map((tag) => (
                                <button
                                    key={tag.id}
                                    data-testid="tag-dropdown-option"
                                    className="w-full text-left px-3 py-2 text-sm font-ui transition-colors duration-150 text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] flex items-center justify-between"
                                    onClick={() => handleAddSelectedTag(tag)}
                                >
                                    <span>{tag.tag_name}</span>
                                    {tag.tag_description && (
                                        <span className="text-xs text-[var(--text-muted)] ml-2 truncate max-w-[120px]" title={tag.tag_description}>
                                            {tag.tag_description}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </form>
            </div>
        ) : (
            <button
                onClick={handleShowAddTagInput}
                data-testid="add-tag-trigger"
                className="bookmark-tag hover:border-[var(--accent-gold)]"
                title="Add new tag"
            >
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add tag
            </button>
        )
    );

    return (
        <div className={`relative ${className}`}>
            {isTagsModified && !embedded ? (
                /* Modified tags container - scholarly panel (skip when embedded) */
                <div className="bg-[var(--surface-elevated)] border border-[var(--border-strong)] rounded-book p-4 shadow-page">
                    {/* Title with gold accent */}
                    <div className="mb-3 pb-2 border-b border-[var(--border-default)]">
                        <h3 className="text-sm font-display font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <svg className="w-4 h-4 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                            {feedbackMode === FeedbackMode.Normal ? "Apply Tags" :
                             feedbackMode === FeedbackMode.RewriteWithFeedback ? "Rewrite with Feedback" :
                             feedbackMode === FeedbackMode.EditWithFeedback ? "Edit with Feedback" : "Apply Tags"}
                        </h3>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-ui font-medium text-[var(--text-muted)]">
                                Tags:
                            </span>
                            {tags.filter(tag => {
                                if ('tag_name' in tag) {
                                    return !(tag.tag_active_initial === false && tag.tag_active_current === false);
                                }
                                return true;
                            }).map((tag, index) => {
                                if ('tag_name' in tag) {
                                    return <TagChip key={tag.id} tag={tag} index={index} isActive={tag.tag_active_current} />;
                                } else {
                                    const isModified = tag.currentActiveTagId !== tag.originalTagId;
                                    return <TagChip key={tag.originalTagId} tag={tag} index={index} isActive={tag.tag_active_current} isPreset isModified={isModified} />;
                                }
                            })}
                            <AddTagInput isDarkBg />
                        </div>

                        {/* Action buttons */}
                        <div className="flex space-x-2 ml-4">
                            <button
                                data-testid="tag-apply-button"
                                onClick={handleApplyRouter}
                                disabled={!explanationId}
                                className={`px-3 py-1.5 text-xs font-ui font-medium rounded-page transition-all duration-200 ${
                                    explanationId
                                        ? 'text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] hover:shadow-warm-md hover:-translate-y-0.5'
                                        : 'text-[var(--text-muted)] bg-[var(--surface-secondary)] cursor-not-allowed opacity-50'
                                }`}
                            >
                                Apply
                            </button>
                            <button
                                data-testid="tag-reset-button"
                                onClick={handleReset}
                                className="px-3 py-1.5 text-xs font-ui font-medium text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page transition-all duration-200 hover:border-[var(--accent-copper)] hover:text-[var(--accent-copper)]"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Changes details (expandable) */}
                    <div className="mt-3 pt-2 border-t border-[var(--border-default)]">
                        <button
                            onClick={() => setShowModifiedMenu(!showModifiedMenu)}
                            data-testid="changes-panel-toggle"
                            className="text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors duration-200 flex items-center"
                        >
                            {showModifiedMenu ? 'Hide' : 'Show'} changes
                            <svg className={`ml-1 w-3 h-3 transition-transform duration-200 ${showModifiedMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {showModifiedMenu && (
                            <div data-testid="changes-panel" className="mt-2 p-3 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page">
                                <span className="text-sm font-ui font-medium text-[var(--text-secondary)] mb-2 block">
                                    What Changed:
                                </span>
                                <div className="space-y-1.5">
                                    {tags.filter(tag => {
                                        if ('tag_name' in tag) {
                                            return !(tag.tag_active_initial === false && tag.tag_active_current === false);
                                        }
                                        return true;
                                    }).map((tag) => {
                                        if ('tag_name' in tag) {
                                            if (tag.tag_active_current !== tag.tag_active_initial) {
                                                return (
                                                    <div key={tag.id} data-testid={tag.tag_active_current ? 'change-added' : 'change-removed'} className="text-sm font-body text-[var(--text-muted)] flex items-center gap-1.5">
                                                        <span className={tag.tag_active_current ? 'text-green-600' : 'text-[var(--accent-copper)]'}>
                                                            {tag.tag_active_current ? '+' : '-'}
                                                        </span>
                                                        {tag.tag_name} ({tag.tag_active_current ? 'restored' : 'removed'})
                                                    </div>
                                                );
                                            }
                                        } else {
                                            if (tag.currentActiveTagId !== tag.originalTagId) {
                                                const currentTag = tag.tags.find((t: TagFullDbType) => t.id === tag.currentActiveTagId);
                                                const originalTag = tag.tags.find((t: TagFullDbType) => t.id === tag.originalTagId);
                                                return (
                                                    <div key={tag.originalTagId} data-testid="change-switched" className="text-sm font-body text-[var(--text-muted)] flex items-center gap-1.5">
                                                        <span className="text-[var(--accent-copper)]">~</span>
                                                        {originalTag?.tag_name} <span className="text-[var(--accent-gold)]">→</span> {currentTag?.tag_name}
                                                    </div>
                                                );
                                            }
                                        }
                                        return null;
                                    }).filter(Boolean)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Normal/embedded tags display */
                <div className={`flex flex-wrap items-center gap-2 ${embedded ? '' : 'py-3'}`}>
                    <span className="text-sm font-ui font-medium text-[var(--text-muted)]">
                        Tags:
                    </span>
                    {tags.filter(tag => {
                        if ('tag_name' in tag) {
                            // When embedded, show all tags (including removed ones); otherwise only active
                            return embedded ? !(tag.tag_active_initial === false && tag.tag_active_current === false) : tag.tag_active_current === true;
                        }
                        return true;
                    }).map((tag, index) => {
                        if ('tag_name' in tag) {
                            return <TagChip key={tag.id} tag={tag} index={index} isActive={tag.tag_active_current} />;
                        } else {
                            const isModified = tag.currentActiveTagId !== tag.originalTagId;
                            return <TagChip key={tag.originalTagId} tag={tag} index={index} isActive={tag.tag_active_current} isPreset isModified={isModified} />;
                        }
                    })}
                    <AddTagInput />
                </div>
            )}
        </div>
    );
}
