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
 * 
 * Used by: Results page to display explanation tags
 * Calls: getTagsByPresetIdAction for preset tag dropdowns
 */
export default function TagBar({ tags, setTags, className = '', onTagClick }: TagBarProps) {
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

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

    return (
        <div className={`flex flex-wrap items-center gap-2 py-2 ${className}`}>
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
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50"
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
                    
                    return (
                        <div key={tag.originalTagId} className="relative">
                            <span
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800/50 hover:bg-purple-200 dark:hover:bg-purple-900/50"
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
    );
} 