'use client';

import { useState, useRef, useEffect } from 'react';
import { TagFullDbType } from '@/lib/schemas/schemas';
import { getTagsByPresetIdAction } from '@/actions/actions';

interface TagBarProps {
    tags: TagFullDbType[];
    className?: string;
    onTagClick?: (tag: TagFullDbType) => void;
}

/**
 * Displays tags in a horizontal bar with chip-style styling
 * 
 * • Renders tags as small colored chips with tag names
 * • Shows empty state when no tags are available
 * • Supports two types of tags: regular and preset tags with dropdowns
 * • For preset tags (presetTagId not null), shows dropdown with related tags
 * • Pre-fetches preset tag data on mount to reduce click latency
 * • Uses consistent styling with the project's design system
 * • Provides hover effects and accessibility features
 * 
 * Used by: Results page to display explanation tags
 * Calls: getTagsByPresetIdAction for preset tag dropdowns
 */
export default function TagBar({ tags, className = '', onTagClick }: TagBarProps) {
    const [dropdownTags, setDropdownTags] = useState<{ [key: number]: TagFullDbType[] }>({});
    const [openDropdown, setOpenDropdown] = useState<number | null>(null);
    const [isLoadingPresetTags, setIsLoadingPresetTags] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    /**
     * Pre-fetches all preset tag data on component mount
     * 
     * • Identifies all unique presetTagIds from the current tags
     * • Fetches all related tags for each presetTagId in a single call
     * • Organizes the data by individual tag ID for quick dropdown access
     * • Handles loading states and error cases
     * • Only runs when tags change to avoid unnecessary API calls
     * 
     * Used by: useEffect on component mount and when tags change
     * Calls: getTagsByPresetIdAction
     */
    const preloadPresetTags = async () => {
        if (!tags || tags.length === 0) return;

        // Extract unique presetTagIds from tags that have presetTagId
        const presetTagIds = [...new Set(
            tags
                .filter(tag => tag.presetTagId !== null)
                .map(tag => tag.presetTagId!)
        )];

        if (presetTagIds.length === 0) return;

        setIsLoadingPresetTags(true);
        try {
            const result = await getTagsByPresetIdAction(presetTagIds);
            
            if (result.success && result.data) {
                // Organize the fetched tags by presetTagId
                const tagsByPresetId: { [presetTagId: number]: TagFullDbType[] } = {};
                result.data.forEach(tag => {
                    if (tag.presetTagId) {
                        if (!tagsByPresetId[tag.presetTagId]) {
                            tagsByPresetId[tag.presetTagId] = [];
                        }
                        tagsByPresetId[tag.presetTagId].push(tag);
                    }
                });

                // Create dropdown data for each tag, excluding the tag itself
                const newDropdownTags: { [key: number]: TagFullDbType[] } = {};
                tags.forEach(tag => {
                    if (tag.presetTagId && tagsByPresetId[tag.presetTagId]) {
                        newDropdownTags[tag.id] = tagsByPresetId[tag.presetTagId].filter(t => t.id !== tag.id);
                    }
                });

                setDropdownTags(newDropdownTags);
            }
        } catch (error) {
            console.error('Failed to preload preset tags:', error);
        } finally {
            setIsLoadingPresetTags(false);
        }
    };

    // Pre-fetch preset tag data when component mounts or tags change
    useEffect(() => {
        preloadPresetTags();
    }, [tags]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    /**
     * Handles clicks on preset tags with pre-loaded data
     * 
     * • Uses pre-fetched dropdown data for instant response
     * • Toggles dropdown open/closed state
     * • No API call needed since data is already loaded
     * 
     * Used by: Tag click handler for preset tags
     * Calls: None - uses pre-loaded data
     */
    const handlePresetTagClick = (tag: TagFullDbType) => {
        if (!tag.presetTagId) return;

        // If dropdown is already open for this tag, close it
        if (openDropdown === tag.id) {
            setOpenDropdown(null);
            return;
        }

        // Use pre-loaded data - no API call needed
        if (dropdownTags[tag.id] && dropdownTags[tag.id].length > 0) {
            setOpenDropdown(tag.id);
        }
    };

    /**
     * Handles clicks on regular tags (no presetTagId)
     * 
     * • Calls the optional onTagClick callback if provided
     * • Closes any open dropdowns
     * 
     * Used by: Tag click handler for regular tags
     * Calls: onTagClick callback
     */
    const handleRegularTagClick = (tag: TagFullDbType) => {
        setOpenDropdown(null);
        if (onTagClick) {
            onTagClick(tag);
        }
    };

    /**
     * Handles clicks on dropdown tag items
     * 
     * • Calls the optional onTagClick callback with the selected tag
     * • Closes the dropdown after selection
     * 
     * Used by: Dropdown item click handler
     * Calls: onTagClick callback
     */
    const handleDropdownTagClick = (tag: TagFullDbType) => {
        setOpenDropdown(null);
        if (onTagClick) {
            onTagClick(tag);
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
            {tags.map((tag) => (
                <div key={tag.id} className="relative">
                    <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-200 cursor-pointer ${
                            tag.presetTagId 
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800/50 hover:bg-purple-200 dark:hover:bg-purple-900/50' 
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                        }`}
                        title={tag.tag_description || tag.tag_name}
                        onClick={() => tag.presetTagId 
                            ? handlePresetTagClick(tag) 
                            : handleRegularTagClick(tag)
                        }
                    >
                        {tag.tag_name}
                        {tag.presetTagId && (
                            <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        )}
                    </span>
                    
                    {/* Dropdown for preset tags */}
                    {openDropdown === tag.id && dropdownTags[tag.id] && dropdownTags[tag.id].length > 0 && (
                        <div 
                            ref={dropdownRef}
                            className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[150px]"
                        >
                            {dropdownTags[tag.id].map((dropdownTag) => (
                                <button
                                    key={dropdownTag.id}
                                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
                                    onClick={() => handleDropdownTagClick(dropdownTag)}
                                >
                                    {dropdownTag.tag_name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
} 