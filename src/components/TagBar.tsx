'use client';

import { useState, useRef, useEffect } from 'react';
import { TagFullDbType, TagUIType } from '@/lib/schemas/schemas';

interface TagBarProps {
    tags: TagUIType[];
    setTags: (tags: TagUIType[]) => void;
    className?: string;
    onTagClick?: (tag: TagFullDbType) => void;
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
 * 
 * Used by: Results page to display explanation tags
 * Calls: getTagsByPresetIdAction for preset tag dropdowns
 */
export default function TagBar({ tags, setTags, className = '', onTagClick }: TagBarProps) {
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const [showModifiedMenu, setShowModifiedMenu] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const modifiedMenuRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
            if (modifiedMenuRef.current && !modifiedMenuRef.current.contains(event.target as Node)) {
                setShowModifiedMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    /**
     * Detects if any tags are in a modified state
     * 
     * • Checks simple tags for tag_active changes from default true state
     * • Checks preset tags for currentActiveTagId != originalTagId
     * • Returns true if any tag has been modified from its original state
     * 
     * Used by: Component to determine if modified menu should be shown
     * Calls: None
     */
    const hasModifiedTags = (): boolean => {
        return tags.some(tag => {
            if ('tag_name' in tag) {
                // Simple tag - check if tag_active is false (modified from default true)
                return tag.tag_active === false;
            } else {
                // Preset tag - check if currentActiveTagId != originalTagId
                return tag.currentActiveTagId !== tag.originalTagId;
            }
        });
    };

    /**
     * Resets all tags back to their original state
     * 
     * • Sets simple tags back to tag_active: true
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
                // Simple tag - reset to active
                return { ...tag, tag_active: true };
            } else {
                // Preset tag - reset to original
                return { ...tag, currentActiveTagId: tag.originalTagId };
            }
        });
        setTags(resetTags);
        setShowModifiedMenu(false);
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
        }
        
        if (onTagClick) {
            onTagClick(selectedTag);
        }
    };

    if (!tags || tags.length === 0) {
        return null;
    }

    const isModified = hasModifiedTags();

    return (
        <div className={`relative ${className}`}>
            {isModified ? (
                /* Modified tags container with dark gray background */
                <div className="bg-gray-800 dark:bg-gray-900 border border-gray-700 dark:border-gray-600 rounded-lg p-4">
                    {/* Original tags layout preserved exactly */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-300">
                                Tags:
                            </span>
                            {tags.map((tag, index) => {
                                // Check if this is a simple tag or preset tag collection
                                if ('tag_name' in tag) {
                                    // Simple tag
                                    return (
                                        <div key={tag.id} className="relative">
                                            <span
                                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                                                    tag.tag_active 
                                                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800/50 hover:bg-red-200 dark:hover:bg-red-900/50'
                                                }`}
                                                title={tag.tag_description || tag.tag_name}
                                                onClick={() => handleSimpleTagClick(tag)}
                                            >
                                                {tag.tag_name}
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
                                                title={currentTag.tag_description || currentTag.tag_name}
                                                onClick={() => handlePresetTagClick(tag)}
                                            >
                                                {currentTag.tag_name}
                                                <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
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
                        </div>

                        {/* Action buttons - much smaller and right-aligned */}
                        <div className="flex space-x-2">
                            <button
                                className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition-colors duration-200 cursor-not-allowed opacity-50"
                                disabled
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
                    {showModifiedMenu && (
                        <div className="mt-4 p-3 bg-gray-700 dark:bg-gray-800 rounded-md">
                            <span className="text-sm font-medium text-gray-300 mb-2 block">
                                What Changed:
                            </span>
                            <div className="space-y-2">
                                {tags.map((tag, index) => {
                                    if ('tag_name' in tag) {
                                        // Simple tag
                                        if (tag.tag_active === false) {
                                            return (
                                                <div key={tag.id} className="text-sm text-gray-400">
                                                    • {tag.tag_name} (deactivated)
                                                </div>
                                            );
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
                    {tags.map((tag, index) => {
                        // Check if this is a simple tag or preset tag collection
                        if ('tag_name' in tag) {
                            // Simple tag
                            return (
                                <div key={tag.id} className="relative">
                                    <span
                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                                            tag.tag_active 
                                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800/50 hover:bg-red-200 dark:hover:bg-red-900/50'
                                        }`}
                                        title={tag.tag_description || tag.tag_name}
                                        onClick={() => handleSimpleTagClick(tag)}
                                    >
                                        {tag.tag_name}
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
                                        title={currentTag.tag_description || currentTag.tag_name}
                                        onClick={() => handlePresetTagClick(tag)}
                                    >
                                        {currentTag.tag_name}
                                        <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
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
                </div>
            )}
        </div>
    );
} 