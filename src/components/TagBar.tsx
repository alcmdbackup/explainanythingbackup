'use client';

import { TagFullDbType } from '@/lib/schemas/schemas';

interface TagBarProps {
    tags: TagFullDbType[];
    className?: string;
}

/**
 * Displays tags in a horizontal bar with chip-style styling
 * 
 * • Renders tags as small colored chips with tag names
 * • Shows empty state when no tags are available
 * • Uses consistent styling with the project's design system
 * • Provides hover effects and accessibility features
 * 
 * Used by: Results page to display explanation tags
 * Calls: None - pure display component
 */
export default function TagBar({ tags, className = '' }: TagBarProps) {
    if (!tags || tags.length === 0) {
        return null;
    }

    return (
        <div className={`flex flex-wrap items-center gap-2 py-2 ${className}`}>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Tags:
            </span>
            {tags.map((tag) => (
                <span
                    key={tag.id}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors duration-200"
                    title={tag.tag_description || tag.tag_name}
                >
                    {tag.tag_name}
                </span>
            ))}
        </div>
    );
} 