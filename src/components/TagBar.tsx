'use client';

import { useState, useRef, useEffect } from 'react';
import { TagFullDbType, TagUIType, TagBarMode } from '@/lib/schemas/schemas';
import { getAllTagsAction } from '@/actions/actions';
import { handleApplyForModifyTags } from '@/lib/services/explanationTags';

interface TagBarProps {
    tags: TagUIType[];
    setTags: (tags: TagUIType[]) => void;
    className?: string;
    onTagClick?: (tag: TagFullDbType) => void;
    explanationId?: number | null;
    modeOverride?: TagBarMode;
    setModeOverride?: (mode: TagBarMode) => void;
    isTagsModified?: boolean;
    setIsTagsModified?: (modified: boolean) => void;
    tagBarApplyClickHandler?: (tagDescriptions: string[]) => void;
    isStreaming?: boolean;
}

/**
 * Displays tags in a horizontal bar with chip-style styling
 * 
 * • Renders tags as small colored chips with tag names
 * • Shows empty state when no tags are available
 * • Supports two types of tags: simple tags and preset tag collections
 * • For preset tag collections, shows dropdown with all related tags
 * • Uses consistent styling with the project's design system
 * • Provides hover effects and accessibility features
 * • Shows pop-down menu when tags are modified with X, Apply, and Reset options
 * • Includes enhanced inline tag addition functionality with searchable dropdown
 * • Surfaces all available tags that are not currently active
 * 
 * Used by: Results page to display explanation tags
 * Calls: getTagsByPresetIdAction for preset tag dropdowns, getAllTagsAction for available tags
 */
export default function TagBar({ tags, setTags, className = '', onTagClick, explanationId, modeOverride, setModeOverride, isTagsModified: externalIsTagsModified, setIsTagsModified: externalSetIsTagsModified, tagBarApplyClickHandler, isStreaming = false }: TagBarProps) {
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const [showModifiedMenu, setShowModifiedMenu] = useState(false);
    const [showAddTagInput, setShowAddTagInput] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [availableTags, setAvailableTags] = useState<TagFullDbType[]>([]);
    const [filteredAvailableTags, setFilteredAvailableTags] = useState<TagFullDbType[]>([]);
    const [isLoadingAvailableTags, setIsLoadingAvailableTags] = useState(false);
    const [showAvailableTagsDropdown, setShowAvailableTagsDropdown] = useState(false);
    const [localIsModified, setLocalIsModified] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const modifiedMenuRef = useRef<HTMLDivElement>(null);
    const addTagInputRef = useRef<HTMLInputElement>(null);
    const availableTagsDropdownRef = useRef<HTMLDivElement>(null);

    // Use external state if provided, otherwise use local state
    const effectiveIsTagsModified = externalIsTagsModified !== undefined ? externalIsTagsModified : localIsModified;
    const setEffectiveIsTagsModified = externalSetIsTagsModified || setLocalIsModified;

    // Close dropdown when clicking outside
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

    // Focus input when add tag input is shown
    useEffect(() => {
        if (showAddTagInput && addTagInputRef.current) {
            addTagInputRef.current.focus();
        }
    }, [showAddTagInput]);

    /**
     * Detects if any tags are in a modified state
     *
     * • Checks simple tags for tag_active_current != tag_active_initial
     * • Checks preset tags for currentActiveTagId != originalTagId
     * • Returns true if any tag has been modified from its original state
     *
     * Used by: Component to determine if modified menu should be shown
     * Calls: None
     */
    const hasModifiedTags = (): boolean => {
        return tags.some(tag => {
            if ('tag_name' in tag) {
                // Simple tag - check if tag_active_current != tag_active_initial
                return tag.tag_active_current !== tag.tag_active_initial;
            } else {
                // Preset tag - check if currentActiveTagId != originalTagId
                return tag.currentActiveTagId !== tag.originalTagId;
            }
        });
    };

    // Update isModified state when tags change
    useEffect(() => {
        const hasModifications = hasModifiedTags();
        const shouldBeModified = hasModifications || (modeOverride !== undefined && modeOverride !== TagBarMode.Normal);
        setEffectiveIsTagsModified(shouldBeModified);
    }, [tags, modeOverride, setEffectiveIsTagsModified, hasModifiedTags]);

    /**
     * Resets all tags back to their original state
     * 
     * • Sets simple tags back to tag_active_current: true
     * • Sets preset tags back to currentActiveTagId: originalTagId
     * • Updates the tags state to reflect the reset
     * • Closes the modified menu after reset
     * 
     * Used by: Reset button click handler
     * Calls: setTags, setShowModifiedMenu
     */
    const handleReset = () => {
        const resetTags = tags.map(tag => {
            if ('tag_name' in tag) {
                // Simple tag - reset tag_active_current back to tag_active_initial
                return { ...tag, tag_active_current: tag.tag_active_initial };
            } else {
                // Preset tag - reset currentActiveTagId back to originalTagId
                return { ...tag, currentActiveTagId: tag.originalTagId };
            }
        });
        setTags(resetTags);
        setShowModifiedMenu(false);
        if (setModeOverride) setModeOverride(TagBarMode.Normal);
        setEffectiveIsTagsModified(false);
    };

    /**
     * Routes apply button clicks to appropriate handler based on mode
     * 
     * • Routes to handleApplyRewriteWithTags for rewrite mode
     * • Routes to handleApplyEditWithTags for edit mode  
     * • Routes to handleApplyNormal for normal mode
     * • Validates explanationId before routing
     * 
     * Used by: Apply button click handler
     * Calls: handleApplyRewriteWithTags, handleApplyEditWithTags, handleApplyNormal
     */
    const handleApplyRouter = async () => {
        console.log('handleApplyRouter called with modeOverride:', modeOverride);
        console.log('TagBarMode.RewriteWithTags:', TagBarMode.RewriteWithTags);
        console.log('explanationId:', explanationId);
        
        // Only require explanationId for normal mode (tag modification)
        if (modeOverride === TagBarMode.Normal && !explanationId) {
            console.error('No explanation ID provided for applying tags');
            return;
        }

        if (modeOverride === TagBarMode.RewriteWithTags) {
            console.log('Routing to handleApplyRewriteWithTags');
            await handleApplyRewriteWithTags();
        } else if (modeOverride === TagBarMode.EditWithTags) {
            console.log('Routing to handleApplyEditWithTags');
            await handleApplyEditWithTags();
        } else {
            console.log('Routing to handleApplyNormal');
            await handleApplyNormal();
        }
    };

    /**
     * Extracts tag descriptions from active tags
     * 
     * • Iterates through all tags and extracts descriptions from active ones
     * • Handles both simple tags and preset tag collections
     * • Returns array of tag descriptions for active tags only
     * • Used by handleApplyRewriteWithTags and handleApplyEditWithTags
     * • Calls: None
     */
    const extractActiveTagDescriptions = (): string[] => {
        console.log('extractActiveTagDescriptions called with tags:', tags);
        const tagDescriptions: string[] = [];
        tags.forEach(tag => {
            if ('tag_name' in tag) {
                // Simple tag - add description if active
                console.log('Processing simple tag:', tag.tag_name, 'active:', tag.tag_active_current);
                if (tag.tag_active_current) {
                    tagDescriptions.push(tag.tag_description);
                }
            } else {
                // Preset tag - add description of current active tag if active
                console.log('Processing preset tag, active:', tag.tag_active_current, 'currentActiveTagId:', tag.currentActiveTagId);
                if (tag.tag_active_current) {
                    const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
                    if (currentTag) {
                        tagDescriptions.push(currentTag.tag_description);
                    }
                }
            }
        });
        console.log('Extracted tag descriptions:', tagDescriptions);
        return tagDescriptions;
    };

    /**
     * Handles apply button click in rewrite with tags mode
     * 
     * • Extracts tag descriptions from active tags
     * • Calls tagBarApplyClickHandler callback with tag descriptions
     * • Used by handleApplyRouter for rewrite mode
     * • Calls: tagBarApplyClickHandler, extractActiveTagDescriptions
     */
    const handleApplyRewriteWithTags = async () => {
        console.log('handleApplyRewriteWithTags called');
        console.log('tagBarApplyClickHandler exists:', !!tagBarApplyClickHandler);
        
        if (tagBarApplyClickHandler) {
            const tagDescriptions = extractActiveTagDescriptions();
            console.log('Calling tagBarApplyClickHandler for rewrite with tags:', tagDescriptions);
            tagBarApplyClickHandler(tagDescriptions);
        } else {
            console.error('tagBarApplyClickHandler is not provided');
        }
    };

    /**
     * Handles apply button click in edit with tags mode
     * 
     * • Extracts tag descriptions from active tags
     * • Calls tagBarApplyClickHandler callback with tag descriptions
     * • Used by handleApplyRouter for edit mode
     * • Calls: tagBarApplyClickHandler, extractActiveTagDescriptions
     */
    const handleApplyEditWithTags = async () => {
        if (tagBarApplyClickHandler) {
            const tagDescriptions = extractActiveTagDescriptions();
            console.log('Calling tagBarApplyClickHandler for edit with tags:', tagDescriptions);
            tagBarApplyClickHandler(tagDescriptions);
        }
    };

    /**
     * Handles apply button click in normal mode
     * 
     * • Calls handleApplyForModifyTags with current tags and explanationId
     * • Updates tags state to reflect the applied changes
     * • Closes the modified menu after successful application
     * • Handles errors and provides user feedback
     * • Used by handleApplyRouter for normal mode
     * • Calls: handleApplyForModifyTags, setTags, setShowModifiedMenu
     */
    const handleApplyNormal = async () => {
        try {
            const result = await handleApplyForModifyTags(explanationId!, tags);
            
            if (result.errors.length > 0) {
                console.error('Errors applying tags:', result.errors);
                // You could add a toast notification here
                return;
            }

            // Update tags to reflect the applied state
            const updatedTags = tags.map(tag => {
                if ('tag_name' in tag) {
                    // Simple tag - update tag_active_initial to match tag_active_current
                    return { ...tag, tag_active_initial: tag.tag_active_current };
                } else {
                    // Preset tag - update originalTagId to match currentActiveTagId
                    return { ...tag, originalTagId: tag.currentActiveTagId };
                }
            });
            
            setTags(updatedTags);
            setShowModifiedMenu(false);
            if (setModeOverride) setModeOverride(TagBarMode.Normal);
            setEffectiveIsTagsModified(false);
            
            console.log(`Successfully applied tags: ${result.added} added, ${result.removed} removed`);
        } catch (error) {
            console.error('Error applying tags:', error);
            // You could add a toast notification here
        }
    };

    /**
     * Handles clicks on preset tag collections
     * 
     * • Toggles dropdown visibility for the clicked preset tag collection
     * • Shows all tags in the collection as dropdown options
     * • Closes other open dropdowns when opening a new one
     * 
     * Used by: Tag click handler for preset tag collections
     * Calls: setOpenDropdown
     */
    const handlePresetTagClick = (presetTag: any) => {
        // If dropdown is already open for this preset tag, close it
        if (openDropdown === presetTag.originalTagId) {
            setOpenDropdown(null);
            return;
        }

        // Open dropdown for this preset tag collection
        setOpenDropdown(presetTag.originalTagId);
    };

    /**
     * Handles clicks on simple tags
     * 
     * • Calls the optional onTagClick callback if provided
     * • Closes any open dropdowns
     * 
     * Used by: Tag click handler for simple tags
     * Calls: onTagClick callback
     */
    const handleSimpleTagClick = (tag: any) => {
        setOpenDropdown(null);
        if (onTagClick) {
            onTagClick(tag);
        }
    };

    /**
     * Handles clicks on dropdown tag items
     * 
     * • Updates the currentActiveTagId for the preset tag collection
     * • Updates the tags state to reflect the new selection
     * • Calls the optional onTagClick callback with the selected tag
     * • Closes the dropdown after selection
     * 
     * Used by: Dropdown item click handler
     * Calls: setTags, onTagClick callback
     */
    const handleDropdownTagClick = (selectedTag: TagFullDbType, presetTagIndex: number) => {
        setOpenDropdown(null);
        
        // Update the currentActiveTagId for the preset tag collection
        const updatedTags = [...tags];
        const presetTag = updatedTags[presetTagIndex];
        
        if ('tags' in presetTag) {
            // This is a preset tag collection
            presetTag.currentActiveTagId = selectedTag.id;
            setTags(updatedTags);
            // The useEffect will automatically update isModified state
        }
        
        if (onTagClick) {
            onTagClick(selectedTag);
        }
    };

    /**
     * Handles removing tags by setting tag_active_current to false
     * 
     * • Sets tag_active_current = false for the specified tag
     * • Updates the tags state to reflect the change
     * • Works for both simple tags and preset tag collections
     * 
     * Used by: "x" button click handlers for tag removal
     * Calls: setTags
     */
    const handleRemoveTag = (tagIndex: number) => {
        const updatedTags = [...tags];
        updatedTags[tagIndex].tag_active_current = false;
        setTags(updatedTags);
        // The useEffect will automatically update isModified state
    };

    /**
     * Handles restoring tags by setting tag_active_current to true
     * 
     * • Sets tag_active_current = true for the specified tag
     * • Updates the tags state to reflect the change
     * • Works for both simple tags and preset tag collections
     * 
     * Used by: "x" button click handlers for tag restoration
     * Calls: setTags
     */
    const handleRestoreTag = (tagIndex: number) => {
        const updatedTags = [...tags];
        updatedTags[tagIndex].tag_active_current = true;
        setTags(updatedTags);
        // The useEffect will automatically update isModified state
    };

    /**
     * Shows the add tag input field
     * 
     * • Sets showAddTagInput to true to display the input field
     * • Clears any previous tag name input
     * • Fetches available tags from database
     * • Shows available tags dropdown for selection
     * 
     * Used by: Add tag button click handler
     * Calls: setShowAddTagInput, setNewTagName, fetchAvailableTags, setShowAvailableTagsDropdown
     */
    const handleShowAddTagInput = () => {
        setShowAddTagInput(true);
        setNewTagName('');
        fetchAvailableTags(); // Fetch available tags when opening add tag interface
        setShowAvailableTagsDropdown(true); // Show dropdown immediately
    };

    /**
     * Handles the add tag input submission
     * 
     * • Prevents default form submission behavior
     * • If there's a search term, filters available tags
     * • If no search term, shows all available tags
     * • Keeps the interface open for tag selection
     * 
     * Used by: Add tag input form submission
     * Calls: filterAvailableTags, setShowAvailableTagsDropdown
     */
    const handleAddTagSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTagName.trim()) {
            // Filter tags based on input
            filterAvailableTags(newTagName.trim());
        } else {
            // Show all available tags if no search term
            setFilteredAvailableTags(availableTags);
            setShowAvailableTagsDropdown(true);
        }
    };

    /**
     * Cancels the add tag operation
     * 
     * • Hides the add tag input field
     * • Clears the input value
     * • Hides the available tags dropdown
     * • Used by escape key or cancel button
     * 
     * Used by: Cancel button click and escape key handler
     * Calls: setShowAddTagInput, setNewTagName, setShowAvailableTagsDropdown
     */
    const handleCancelAddTag = () => {
        setShowAddTagInput(false);
        setNewTagName('');
        setShowAvailableTagsDropdown(false);
    };

    /**
     * Handles escape key press in the add tag input
     * 
     * • Cancels the add tag operation when escape is pressed
     * • Provides keyboard navigation for accessibility
     * 
     * Used by: Add tag input keydown event
     * Calls: handleCancelAddTag
     */
    const handleAddTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleCancelAddTag();
        }
    };

    /**
     * Fetches all available tags and filters out currently active ones
     * 
     * • Calls getAllTagsAction to retrieve all tags from database
     * • Filters out tags that are already active in the current tag set
     * • Updates availableTags state with filtered results
     * • Handles loading states and error cases
     * 
     * Used by: handleShowAddTagInput when opening add tag interface
     * Calls: getAllTagsAction
     */
    const fetchAvailableTags = async () => {
        setIsLoadingAvailableTags(true);
        try {
            const result = await getAllTagsAction();
            if (result.success && result.data) {
                // Filter out tags that are already active or part of preset collections
                const excludedTagIds = new Set<number>();
                tags.forEach(tag => {
                    if ('tag_name' in tag) {
                        // Simple tag - if active, add to excluded set
                        if (tag.tag_active_current) {
                            excludedTagIds.add(tag.id);
                        }
                    } else {
                        // Preset tag - add current active tag ID and ALL tags in the preset collection
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

    /**
     * Filters available tags based on search input
     * 
     * • Updates filteredAvailableTags based on newTagName input
     * • Performs case-insensitive partial matching on tag names
     * • Shows all available tags if search is empty
     * • Updates the dropdown display in real-time
     * • Ensures dropdown is visible when filtering
     * 
     * Used by: newTagName onChange handler
     * Calls: setFilteredAvailableTags, setShowAvailableTagsDropdown
     */
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
        // Ensure dropdown is visible when filtering
        setShowAvailableTagsDropdown(true);
    };

    /**
     * Adds a selected tag to the current tag set
     * 
     * • Creates a new simple tag with the selected tag data
     * • Sets tag as active (tag_active_current: true)
     * • Adds the new tag to the tags array
     * • Closes the add tag interface
     * • Clears the search input
     * 
     * Used by: Available tags dropdown item click handler
     * Calls: setTags, setShowAddTagInput, setNewTagName
     */
    const handleAddSelectedTag = (selectedTag: TagFullDbType) => {
        const newTag: TagUIType = {
            ...selectedTag,
            tag_active_current: true,
            tag_active_initial: false
        };
        
        setTags([...tags, newTag]);
        setShowAddTagInput(false);
        setNewTagName('');
        setShowAvailableTagsDropdown(false);
        // The useEffect will automatically update isModified state
    };

    // During streaming, always show the TagBar even if there are no tags
    console.log('TagBar: isStreaming =', isStreaming, 'tags.length =', tags?.length);
    if (isStreaming) {
        return (
            <div className={`relative ${className}`}>
                <div className="flex flex-wrap items-center gap-2 py-2">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        Tags:
                    </span>
                    <button
                        disabled={true}
                        className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full cursor-not-allowed opacity-50"
                        title="Add new tag (disabled during streaming)"
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

    // If not streaming and no tags, don't show anything
    if (!tags || tags.length === 0) {
        return null;
    }

    const isTagsModified = effectiveIsTagsModified;

    return (
        <div className={`relative ${className}`}>
            {isTagsModified ? (
                /* Modified tags container with dark gray background */
                <div className="bg-gray-800 dark:bg-gray-900 border border-gray-700 dark:border-gray-600 rounded-lg p-4">
                    {/* Title based on modification state */}
                    <div className="mb-3">
                        <h3 className="text-sm font-semibold text-gray-200">
                            {modeOverride === TagBarMode.Normal ? "Apply tags" : 
                             modeOverride === TagBarMode.RewriteWithTags ? "Rewrite with tags" :
                             modeOverride === TagBarMode.EditWithTags ? "Edit with tags" : "Apply tags"}
                        </h3>
                    </div>
                    {/* Original tags layout preserved exactly */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-300">
                                Tags:
                            </span>
                                                {tags.filter(tag => {
                                // Filter out tags that were never active (tag_active_initial = false and tag_active_current = false)
                                if ('tag_name' in tag) {
                                    return !(tag.tag_active_initial === false && tag.tag_active_current === false);
                                }
                                return true; // Always show preset tags
                            }).map((tag, index) => {
                                // Check if this is a simple tag or preset tag collection
                                if ('tag_name' in tag) {
                                    // Simple tag
                                    return (
                                        <div key={tag.id} className="relative">
                                                                                <span
                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                                            tag.tag_active_current 
                                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700/50 line-through opacity-75'
                                        }`}
                                        title={tag.tag_active_current ? tag.tag_description : `Removed: ${tag.tag_description} (click to restore)`}
                                        onClick={() => tag.tag_active_current ? handleSimpleTagClick(tag) : handleRestoreTag(index)}
                                    >
                                        {tag.tag_name}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent dropdown from closing
                                                if (tag.tag_active_current) {
                                                    handleRemoveTag(index);
                                                } else {
                                                    handleRestoreTag(index);
                                                }
                                            }}
                                            className="ml-1 hover:opacity-70"
                                            title={tag.tag_active_current ? "Remove tag" : "Restore tag"}
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                {tag.tag_active_current ? (
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                ) : (
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                                )}
                                            </svg>
                                        </button>
                                    </span>
                                        </div>
                                    );
                                } else {
                                    // Preset tag collection
                                    const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId) || tag.tags[0];
                                    
                                    if (!currentTag) {
                                        console.error('No current tag found for preset tag collection:', tag);
                                        return null;
                                    }
                                    
                                    const isTagModified = tag.currentActiveTagId !== tag.originalTagId;
                                    
                                    return (
                                        <div key={tag.originalTagId} className="relative">
                                            <span
                                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                                                    isTagModified
                                                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800/50 hover:bg-orange-200 dark:hover:bg-orange-900/50'
                                                        : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800/50 hover:bg-purple-200 dark:hover:bg-purple-900/50'
                                                }`}
                                                title={currentTag.tag_description}
                                                onClick={() => handlePresetTagClick(tag)}
                                            >
                                                {currentTag.tag_name}
                                                <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation(); // Prevent dropdown from closing
                                                        handleRemoveTag(index);
                                                    }}
                                                    className="ml-1 hover:opacity-70"
                                                    title="Remove tag"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </span>
                                            
                                            {/* Dropdown for preset tag collections */}
                                            {openDropdown === tag.originalTagId && (
                                                <div 
                                                    ref={dropdownRef}
                                                    className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[150px]"
                                                >
                                                    {tag.tags.map((dropdownTag) => (
                                                        <button
                                                            key={dropdownTag.id}
                                                            className={`w-full text-left px-3 py-2 text-sm transition-colors duration-150 flex items-center justify-between ${
                                                                dropdownTag.id === tag.currentActiveTagId
                                                                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                            }`}
                                                            onClick={() => handleDropdownTagClick(dropdownTag, index)}
                                                        >
                                                            <span>{dropdownTag.tag_name}</span>
                                                            {dropdownTag.id === tag.currentActiveTagId && (
                                                                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }
                            })}
                            
                            {/* Add tag button or input field */}
                            {showAddTagInput ? (
                                <div className="relative inline-flex items-center">
                                    <form onSubmit={handleAddTagSubmit} className="inline-flex items-center">
                                    <input
                                        ref={addTagInputRef}
                                        type="text"
                                        value={newTagName}
                                        onChange={(e) => filterAvailableTags(e.target.value)}
                                        onKeyDown={handleAddTagKeyDown}
                                        placeholder="Enter tag name..."
                                        className="px-2.5 py-0.5 text-xs border border-gray-400 dark:border-gray-500 rounded-full bg-gray-700 dark:bg-gray-800 text-gray-100 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[120px]"
                                        maxLength={50}
                                    />
                                    {isLoadingAvailableTags ? (
                                        <svg className="animate-spin h-4 w-4 text-gray-300 dark:text-gray-600 ml-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <>
                                            <button
                                                type="submit"
                                                className="ml-1 px-2 py-0.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-full transition-colors duration-200"
                                            >
                                                Add
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCancelAddTag}
                                                className="ml-1 px-2 py-0.5 text-xs font-medium text-gray-300 dark:text-gray-400 bg-gray-600 hover:bg-gray-500 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full transition-colors duration-200"
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}
                                    
                                    {/* Available tags dropdown */}
                                    {showAvailableTagsDropdown && filteredAvailableTags.length > 0 && (
                                        <div 
                                            ref={availableTagsDropdownRef}
                                            className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px] max-h-48 overflow-y-auto"
                                        >
                                            {filteredAvailableTags.map((tag) => (
                                                <button
                                                    key={tag.id}
                                                    className="w-full text-left px-3 py-2 text-sm transition-colors duration-150 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                                                    onClick={() => handleAddSelectedTag(tag)}
                                                >
                                                    <span>{tag.tag_name}</span>
                                                    {tag.tag_description && (
                                                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 truncate max-w-[120px]" title={tag.tag_description}>
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
                                    className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium text-gray-300 dark:text-gray-400 bg-gray-700 hover:bg-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-600 dark:border-gray-500 rounded-full transition-colors duration-200 hover:border-gray-500 dark:hover:border-gray-400"
                                    title="Add new tag"
                                >
                                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                    Add tag
                                </button>
                            )}
                        </div>

                        {/* Action buttons - much smaller and right-aligned */}
                        <div className="flex space-x-2">
                            <button
                                onClick={handleApplyRouter}
                                disabled={!explanationId}
                                className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 ${
                                    explanationId 
                                        ? 'text-white bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 cursor-pointer'
                                        : 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 cursor-not-allowed opacity-50'
                                }`}
                            >
                                Apply
                            </button>
                            <button
                                onClick={handleReset}
                                className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded transition-colors duration-200"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Modified tags details (expandable) */}
                    <div className="mt-3 flex items-center justify-between">
                        <button
                            onClick={() => setShowModifiedMenu(!showModifiedMenu)}
                            className="text-xs text-gray-400 hover:text-gray-300 transition-colors duration-200 flex items-center"
                        >
                            {showModifiedMenu ? 'Hide' : 'Show'} changes
                            <svg className={`ml-1 w-3 h-3 transition-transform duration-200 ${showModifiedMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    </div>
                    {showModifiedMenu && (
                        <div className="mt-2 p-3 bg-gray-700 dark:bg-gray-800 rounded-md">
                            <span className="text-sm font-medium text-gray-300 mb-2 block">
                                What Changed:
                            </span>
                            <div className="space-y-2">
                                {tags.filter(tag => {
                                    // Filter out tags that were never active (tag_active_initial = false and tag_active_current = false)
                                    if ('tag_name' in tag) {
                                        return !(tag.tag_active_initial === false && tag.tag_active_current === false);
                                    }
                                    return true; // Always show preset tags
                                }).map((tag, index) => {
                                    if ('tag_name' in tag) {
                                        // Simple tag
                                        if (tag.tag_active_current !== tag.tag_active_initial) {
                                            if (tag.tag_active_current === false) {
                                                return (
                                                    <div key={tag.id} className="text-sm text-gray-400">
                                                        • {tag.tag_name} (removed - click to restore)
                                                    </div>
                                                );
                                            } else {
                                                return (
                                                    <div key={tag.id} className="text-sm text-gray-400">
                                                        • {tag.tag_name} (restored)
                                                    </div>
                                                );
                                            }
                                        }
                                    } else {
                                        // Preset tag
                                        if (tag.currentActiveTagId !== tag.originalTagId) {
                                            const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
                                            const originalTag = tag.tags.find(t => t.id === tag.originalTagId);
                                            return (
                                                <div key={tag.originalTagId} className="text-sm text-gray-400">
                                                    • {originalTag?.tag_name} → {currentTag?.tag_name}
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
            ) : (
                /* Normal tags display when not modified - exactly as before */
                <div className="flex flex-wrap items-center gap-2 py-2">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        Tags:
                    </span>
                    {tags.filter(tag => {
                        // Only show simple tags that are active, or any preset tags
                        if ('tag_name' in tag) {
                            return tag.tag_active_current === true;
                        }
                        return true; // Always show preset tags
                    }).map((tag, index) => {
                        // Check if this is a simple tag or preset tag collection
                        if ('tag_name' in tag) {
                            // Simple tag
                            return (
                                <div key={tag.id} className="relative">
                                    <span
                                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                        title={tag.tag_description}
                                        onClick={() => handleSimpleTagClick(tag)}
                                    >
                                        {tag.tag_name}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent dropdown from closing
                                                handleRemoveTag(index);
                                            }}
                                            className="ml-1 hover:opacity-70"
                                            title="Remove tag"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </span>
                                </div>
                            );
                        } else {
                            // Preset tag collection
                            const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId) || tag.tags[0];
                            
                            if (!currentTag) {
                                console.error('No current tag found for preset tag collection:', tag);
                                return null;
                            }
                            
                            const isTagModified = tag.currentActiveTagId !== tag.originalTagId;
                            
                            return (
                                <div key={tag.originalTagId} className="relative">
                                    <span
                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                                            isTagModified
                                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800/50 hover:bg-orange-200 dark:hover:bg-orange-900/50'
                                                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800/50 hover:bg-purple-200 dark:hover:bg-purple-900/50'
                                        }`}
                                        title={currentTag.tag_description}
                                        onClick={() => handlePresetTagClick(tag)}
                                    >
                                        {currentTag.tag_name}
                                        <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent dropdown from closing
                                                handleRemoveTag(index);
                                            }}
                                            className="ml-1 hover:opacity-70"
                                            title="Remove tag"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </span>
                                    
                                    {/* Dropdown for preset tag collections */}
                                    {openDropdown === tag.originalTagId && (
                                        <div 
                                            ref={dropdownRef}
                                            className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[150px]"
                                        >
                                            {tag.tags.map((dropdownTag) => (
                                                <button
                                                    key={dropdownTag.id}
                                                    className={`w-full text-left px-3 py-2 text-sm transition-colors duration-150 flex items-center justify-between ${
                                                        dropdownTag.id === tag.currentActiveTagId
                                                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                    }`}
                                                    onClick={() => handleDropdownTagClick(dropdownTag, index)}
                                                >
                                                    <span>{dropdownTag.tag_name}</span>
                                                    {dropdownTag.id === tag.currentActiveTagId && (
                                                        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                    })}
                    
                    {/* Add tag button or input field */}
                    {showAddTagInput ? (
                        <div className="relative inline-flex items-center">
                            <form onSubmit={handleAddTagSubmit} className="inline-flex items-center">
                            <input
                                ref={addTagInputRef}
                                type="text"
                                value={newTagName}
                                onChange={(e) => filterAvailableTags(e.target.value)}
                                onKeyDown={handleAddTagKeyDown}
                                placeholder="Enter tag name..."
                                className="px-2.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[120px]"
                                maxLength={50}
                            />
                            {isLoadingAvailableTags ? (
                                <svg className="animate-spin h-4 w-4 text-gray-300 dark:text-gray-600 ml-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <>
                                    <button
                                        type="submit"
                                        className="ml-1 px-2 py-0.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-full transition-colors duration-200"
                                    >
                                        Add
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancelAddTag}
                                        className="ml-1 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full transition-colors duration-200"
                                    >
                                        Cancel
                                    </button>
                                </>
                            )}
                            
                            </form>
                            
                            {/* Available tags dropdown */}
                            {showAvailableTagsDropdown && filteredAvailableTags.length > 0 && (
                                <div 
                                    ref={availableTagsDropdownRef}
                                    className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px] max-h-48 overflow-y-auto"
                                >
                                    {filteredAvailableTags.map((tag) => (
                                        <button
                                            key={tag.id}
                                            className="w-full text-left px-3 py-2 text-sm transition-colors duration-150 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                                            onClick={() => handleAddSelectedTag(tag)}
                                        >
                                            <span>{tag.tag_name}</span>
                                            {tag.tag_description && (
                                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 truncate max-w-[120px]" title={tag.tag_description}>
                                                    {tag.tag_description}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={handleShowAddTagInput}
                            className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-full transition-colors duration-200 hover:border-gray-400 dark:hover:border-gray-500"
                            title="Add new tag"
                        >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add tag
                        </button>
                    )}
                </div>
            )}
        </div>
    );
} 