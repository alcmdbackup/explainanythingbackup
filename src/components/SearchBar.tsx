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
 * - home: Large centered search for the home page (catalog card style)
 * - nav: Compact search for navigation bars (inline style)
 *
 * Midnight Scholar theme:
 * - Book-edge rounded corners
 * - Gold focus ring and border
 * - Italic serif placeholder
 * - Warm shadows
 */
export default function SearchBar({
    variant = 'home',
    placeholder = 'Search any topic...',
    maxLength = 150,
    className = '',
    initialValue = '',
    onSearch,
    disabled = false
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!prompt.trim() || disabled) return;
            if (onSearch) {
                onSearch(prompt);
            } else {
                router.push(`/results?q=${encodeURIComponent(prompt)}`);
            }
        }
    };

    const isHomeVariant = variant === 'home';
    const InputComponent = isHomeVariant ? 'textarea' : 'input';
    const inputProps = isHomeVariant ? { rows: 1 } : {};

    return (
        <form onSubmit={handleSubmit} className={`w-full ${className}`}>
            <div className={`
                flex items-center
                bg-[var(--surface-secondary)]
                border border-[var(--border-default)]
                shadow-warm
                transition-all duration-200
                focus-within:border-[var(--accent-gold)]
                focus-within:shadow-gold-glow
                focus-within:ring-2 focus-within:ring-[var(--accent-gold)]/20
                ${isHomeVariant
                    ? 'rounded-book'
                    : 'rounded-page'
                }
            `}>
                {/* Magnifying glass icon */}
                <div className={`flex-shrink-0 text-[var(--text-muted)] ${isHomeVariant ? 'pl-5' : 'pl-3'}`}>
                    <svg
                        className={`${isHomeVariant ? 'w-5 h-5' : 'w-4 h-4'}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                </div>

                <InputComponent
                    value={prompt}
                    onChange={handlePromptChange}
                    onKeyDown={isHomeVariant ? handleKeyDown : undefined}
                    data-testid="search-input"
                    className={`
                        flex-1 bg-transparent border-0
                        focus:outline-none focus:ring-0
                        resize-none
                        font-body
                        text-[var(--text-primary)]
                        placeholder:text-[var(--text-muted)]
                        placeholder:italic
                        disabled:opacity-50
                        ${isHomeVariant
                            ? 'px-4 py-3.5 text-base'
                            : 'px-3 py-2 text-sm'
                        }
                    `}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    disabled={disabled}
                    {...inputProps}
                />

                <button
                    type="submit"
                    disabled={disabled || !prompt.trim()}
                    data-testid="search-submit"
                    className={`
                        font-ui font-medium
                        text-[var(--text-on-primary)]
                        bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
                        focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-all duration-200
                        hover:shadow-warm-md
                        hover:-translate-y-px
                        active:translate-y-0
                        ${isHomeVariant
                            ? 'px-6 py-3.5 rounded-r-book text-base'
                            : 'px-4 py-2 rounded-r-page text-sm'
                        }
                    `}
                >
                    {disabled ? (
                        <span className="flex items-center gap-2">
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Searching...
                        </span>
                    ) : (
                        isHomeVariant ? 'Explore' : 'Search'
                    )}
                </button>
            </div>
        </form>
    );
}
