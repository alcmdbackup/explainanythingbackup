'use client';

import Link from 'next/link';
import { signOut } from '@/app/login/actions';
import SearchBar from '@/components/SearchBar';

interface NavigationProps {
    showSearchBar?: boolean;
    searchBarProps?: {
        placeholder?: string;
        maxLength?: number;
        initialValue?: string;
        onSearch?: (query: string) => void;
    };
}

/**
 * Reusable navigation component with optional search bar
 * 
 * • Renders the main app navigation with logo, optional search bar, and navigation links
 * • Handles logout functionality through signOut action
 * • Supports customizable search bar with configurable props
 * • Maintains consistent styling and responsive design
 * 
 * Used by: Results page, other pages that need navigation
 * Calls: signOut, SearchBar component
 */
export default function Navigation({ 
    showSearchBar = true, 
    searchBarProps = {} 
}: NavigationProps) {
    return (
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-14">
                    <h1 className="text-xl font-medium text-gray-900 dark:text-white tracking-wide font-proxima">
                        Explain Anything
                    </h1>
                    
                    {/* Optional Search Bar */}
                    {showSearchBar && (
                        <div className="flex-1 max-w-md mx-8">
                            <SearchBar 
                                variant="nav"
                                placeholder="Search any topic..."
                                maxLength={100}
                                {...searchBarProps}
                            />
                        </div>
                    )}
                    
                    <div className="flex items-center space-x-6">
                        <Link 
                            href="/" 
                            className="text-gray-700 hover:text-blue-700 dark:text-gray-300 dark:hover:text-blue-400 text-base font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 rounded"
                        >
                            Home
                        </Link>
                        <Link 
                            href="/explanations" 
                            className="text-gray-700 hover:text-blue-700 dark:text-gray-300 dark:hover:text-blue-400 text-base font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 rounded"
                        >
                            All explanations
                        </Link>
                        <button
                            onClick={() => signOut()}
                            className="text-gray-700 hover:text-red-700 dark:text-gray-300 dark:hover:text-red-400 text-base font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 rounded"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-gray-300/50 to-transparent dark:via-gray-600/50"></div>
        </nav>
    );
} 