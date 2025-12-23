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
 * The Atlas SearchBar - Minimal, elegant search input
 *
 * - home: Large centered search with prominent styling
 * - nav: Compact pill-shaped search for navigation
 *
 * Clean borders, subtle focus states, accent blue highlights
 */
export default function SearchBar({
    variant = 'home',
    placeholder = 'Learn about any topic',
    maxLength = 150,
    className = '',
    initialValue = '',
    onSearch,
    disabled = false
}: SearchBarProps) {
    const [prompt, setPrompt] = useState(initialValue);
    const router = useRouter();

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

    if (isHomeVariant) {
        // Home variant - Large, prominent search
        return (
            <form onSubmit={handleSubmit} className={`w-full max-w-2xl mx-auto ${className}`}>
                <div className="relative group">
                    <InputComponent
                        value={prompt}
                        onChange={handlePromptChange}
                        onKeyDown={handleKeyDown}
                        data-testid="search-input"
                        className="w-full bg-[var(--surface-primary)] dark:bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-6 py-4 text-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-body resize-none rounded-none search-focus-glow"
                        placeholder={placeholder}
                        maxLength={maxLength}
                        disabled={disabled}
                        {...inputProps}
                    />
                    <button
                        type="submit"
                        disabled={disabled || !prompt.trim()}
                        data-testid="search-submit"
                        className="absolute right-3 top-1/2 -translate-y-1/2 atlas-button disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {disabled ? (
                            <span className="atlas-loading-dots">
                                <span className="atlas-loading-dot"></span>
                                <span className="atlas-loading-dot"></span>
                                <span className="atlas-loading-dot"></span>
                            </span>
                        ) : 'Search'}
                    </button>
                </div>
            </form>
        );
    }

    // Nav variant - Compact pill search
    return (
        <form onSubmit={handleSubmit} className={`w-full ${className}`}>
            <div className="flex items-center">
                <input
                    type="text"
                    value={prompt}
                    onChange={handlePromptChange}
                    data-testid="search-input"
                    className="w-full bg-transparent border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-ui rounded-full search-focus-glow"
                    placeholder={placeholder}
                    maxLength={maxLength}
                    disabled={disabled}
                />
            </div>
        </form>
    );
}
