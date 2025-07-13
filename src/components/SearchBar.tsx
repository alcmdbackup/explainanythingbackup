'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SearchBarProps {
    variant?: 'home' | 'nav';
    placeholder?: string;
    maxLength?: number;
    className?: string;
    initialValue?: string;
    onSearch?: (query: string) => void;
    disabled?: boolean;
}

/**
 * Reusable search bar component with two variants:
 * - home: Large centered search for the home page
 * - nav: Compact search for navigation bars
 * 
 * Handles form submission and navigation to results page
 * Supports controlled input with external value management
 */
export default function SearchBar({ 
    variant = 'home', 
    placeholder = 'Learn about any topic',
    maxLength = 150,
    className = '',
    initialValue = '',
    onSearch,
    disabled = false //not all pages have a React state to attach to this
}: SearchBarProps) {
    const [prompt, setPrompt] = useState(initialValue);
    const router = useRouter();

    // Update internal state when initialValue changes (for controlled input)
    useEffect(() => {
        setPrompt(initialValue);
    }, [initialValue]);

    const handlePromptChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setPrompt(e.target.value);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || disabled) return;
        
        if (onSearch) {
            onSearch(prompt);
        } else {
            router.push(`/results?q=${encodeURIComponent(prompt)}`);
        }
    };

    const isHomeVariant = variant === 'home';
    const InputComponent = isHomeVariant ? 'textarea' : 'input';
    const inputProps = isHomeVariant ? { rows: 1 } : {};

    return (
        <form onSubmit={handleSubmit} className={`w-full ${className}`}>
            <div className={`flex items-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-sm focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-blue-600 dark:focus-within:ring-blue-500 dark:focus-within:border-blue-500 transition-all duration-200 ${
                isHomeVariant ? 'rounded-full' : 'rounded-lg'
            }`}>
                <InputComponent
                    value={prompt}
                    onChange={handlePromptChange}
                    className={`flex-1 bg-transparent border-0 focus:outline-none focus:ring-0 resize-none dark:text-white placeholder-gray-500 dark:placeholder-gray-400 ${
                        isHomeVariant 
                            ? 'px-4 py-2.5 rounded-l-full text-base' 
                            : 'px-3 py-1.5 rounded-l-lg text-sm'
                    }`}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    disabled={disabled}
                    {...inputProps}
                />
                <button
                    type="submit"
                    disabled={disabled}
                    className={`text-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 bg-blue-600 hover:bg-blue-700 ${
                        isHomeVariant 
                            ? 'px-6 py-2.5 rounded-r-full text-base' 
                            : 'px-3 py-1.5 rounded-r-lg text-sm'
                    }`}
                >
                    {disabled ? 'Searching...' : isHomeVariant ? 'Search Topic' : 'Search'}
                </button>
            </div>
        </form>
    );
} 